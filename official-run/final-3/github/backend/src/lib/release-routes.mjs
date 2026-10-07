// HTTP surface of the repository releases (REQ-4-5): the list a visitor may
// read, one release detail and the publishing operation.
//
// Every read re-applies the shared repository read rule, so a release of a
// private repository is never exposed to a caller without permission. Publishing
// re-checks the write rule against the stored grants rather than trusting the
// UI, so a Read or Triage caller is refused even though the control is hidden.
// A tag the repository already uses is refused with the exact
// "Tag already exists" message and writes nothing.

import { readJson, sendJson } from "./http.mjs";
import { ORG_MESSAGES } from "./org-rules.mjs";
import {
  RELEASE_MESSAGES,
  validateReleaseTag,
  validateReleaseTitle,
} from "./release-rules.mjs";
import { publicRepository } from "./org-store.mjs";

const REPOSITORIES_PREFIX = "/api/repositories/";
const RELEASES_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/releases$/;
const RELEASE_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/releases\/([^/]+)$/;

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readBody(request) {
  return readJson(request).catch(() => ({}));
}

export function createReleaseRoutes({ orgStore, findRepository, describeOwner, currentUser }) {
  async function withOwner(repository) {
    return {
      ...publicRepository(repository),
      owner: await describeOwner(repository.ownerType, repository.ownerId),
    };
  }

  async function readableRepository(response, owner, name, user) {
    const repository = await findRepository(decodeSegment(owner), decodeSegment(name));
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return null;
    }
    if (!(await orgStore.canReadRepository(repository, user?.id ?? null))) {
      sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
      return null;
    }
    return repository;
  }

  return async function handleReleases(request, response, url, method) {
    const { pathname } = url;
    if (!pathname.startsWith(REPOSITORIES_PREFIX)) return false;

    const releasesMatch = pathname.match(RELEASES_PATH);
    const releaseMatch = releasesMatch ? null : pathname.match(RELEASE_PATH);
    const match = releasesMatch ?? releaseMatch;
    if (!match) return false;

    const user = await currentUser(request);
    const repository = await readableRepository(response, match[1], match[2], user);
    if (!repository) return true;

    const payload = async (release) => ({
      repository: await withOwner(repository),
      release,
      canWrite: await orgStore.canWriteRepository(repository, user?.id ?? null),
    });

    // GET .../releases — the persisted releases of this repository.
    if (releasesMatch && method === "GET") {
      sendJson(response, 200, {
        repository: await withOwner(repository),
        releases: await orgStore.listReleases(repository.id),
        canWrite: await orgStore.canWriteRepository(repository, user?.id ?? null),
      });
      return true;
    }

    // POST .../releases — publish one release bound to its exact tag.
    if (releasesMatch && method === "POST") {
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      if (!(await orgStore.canWriteRepository(repository, user.id))) {
        sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
        return true;
      }
      const body = await readBody(request);
      const tag = typeof body.tag === "string" ? body.tag.trim() : "";
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const description = typeof body.description === "string" ? body.description : "";
      const targetBranch = typeof body.targetBranch === "string" ? body.targetBranch.trim() : "";

      const listed = await orgStore.listRepositoryBranches(repository.id);
      const branches = listed?.branches ?? [];
      const branchName = targetBranch || repository.defaultBranch || "main";

      const fieldErrors = {};
      if (!validateReleaseTag(tag)) fieldErrors.tag = RELEASE_MESSAGES.tagRequired;
      if (!validateReleaseTitle(title)) fieldErrors.title = RELEASE_MESSAGES.titleRequired;
      if (!branches.some((branch) => branch.name === branchName)) {
        fieldErrors.targetBranch = RELEASE_MESSAGES.branchInvalid;
      }
      if (Object.keys(fieldErrors).length > 0) {
        sendJson(response, 400, { message: "Validation failed", fieldErrors });
        return true;
      }

      const created = await orgStore.createRelease({
        repositoryId: repository.id,
        tag,
        title,
        description,
        targetBranch: branchName,
        authorName: user.username,
        authorAccountId: user.id,
      });
      if (!created.ok) {
        sendJson(response, 400, {
          message: RELEASE_MESSAGES.tagExists,
          fieldErrors: { tag: RELEASE_MESSAGES.tagExists },
        });
        return true;
      }
      sendJson(response, 201, await payload(created.release));
      return true;
    }

    // GET .../releases/:tag — the detail view of one release.
    if (releaseMatch && method === "GET") {
      const release = await orgStore.getRelease(repository.id, decodeSegment(releaseMatch[3]));
      if (!release) {
        sendJson(response, 404, { message: RELEASE_MESSAGES.releaseNotFound });
        return true;
      }
      sendJson(response, 200, await payload(release));
      return true;
    }

    return false;
  };
}
