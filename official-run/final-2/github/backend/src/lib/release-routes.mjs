// HTTP surface of the repository releases (REQ-4-5).
//
// Every read re-applies the shared repository read rule, so a visitor of a
// public repository can read its published releases and nobody outside the read
// rule ever sees one. Publishing is checked against the stored grants: only
// Write, Maintain, Admin or an organization Owner may create a release, and a
// duplicate tag is refused with the exact message the form displays.

import { normalizeText } from "./auth-rules.mjs";
import { readJson, sendJson } from "./http.mjs";
import { ORG_MESSAGES, RELEASE_MESSAGES, validateReleaseTag } from "./org-rules.mjs";
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

  /** The existing branch names of one repository, which the form selects from. */
  async function branchNames(repository) {
    const listed = await orgStore.listRepositoryBranches(repository.id);
    return listed ? listed.branches.map((branch) => branch.name) : [];
  }

  return async function handleReleases(request, response, url, method) {
    const { pathname } = url;
    if (!pathname.startsWith(REPOSITORIES_PREFIX)) return false;

    const listMatch = pathname.match(RELEASES_PATH);
    const detailMatch = listMatch ? null : pathname.match(RELEASE_PATH);
    if (!listMatch && !detailMatch) return false;

    const match = listMatch ?? detailMatch;
    const user = await currentUser(request);
    const repository = await readableRepository(response, match[1], match[2], user);
    if (!repository) return true;
    const canWrite = await orgStore.canWriteRepository(repository, user?.id ?? null);

    // GET /api/repositories/:owner/:name/releases — the published releases of
    // this repository, readable with the repository itself.
    if (listMatch && method === "GET") {
      sendJson(response, 200, {
        repository: await withOwner(repository),
        releases: await orgStore.listRepositoryReleases(repository.id),
        canWrite,
      });
      return true;
    }

    // POST /api/repositories/:owner/:name/releases — publish one release for an
    // existing branch and an unused tag. A non-writer is refused here even when
    // the form is never rendered for it.
    if (listMatch && method === "POST") {
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      if (!canWrite) {
        sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
        return true;
      }
      const body = await readJson(request).catch(() => ({}));
      const tag = normalizeText(body.tag);
      const title = typeof body.title === "string" ? normalizeText(body.title) : "";
      const description = typeof body.description === "string" ? body.description : "";
      const targetBranch = normalizeText(body.branch ?? body.targetBranch);

      const fieldErrors = {};
      if (!validateReleaseTag(tag)) fieldErrors.tag = RELEASE_MESSAGES.tagRequired;
      const names = await branchNames(repository);
      if (!targetBranch) fieldErrors.branch = RELEASE_MESSAGES.branchRequired;
      else if (!names.includes(targetBranch)) fieldErrors.branch = RELEASE_MESSAGES.branchNotFound;
      if (Object.keys(fieldErrors).length > 0) {
        sendJson(response, 400, { message: "Validation failed", fieldErrors });
        return true;
      }

      if (await orgStore.getRepositoryRelease(repository.id, tag)) {
        sendJson(response, 400, {
          message: RELEASE_MESSAGES.tagExists,
          fieldErrors: { tag: RELEASE_MESSAGES.tagExists },
        });
        return true;
      }

      const result = await orgStore.createRepositoryRelease({
        repositoryId: repository.id,
        tag,
        title,
        description,
        targetBranch,
        authorName: user.username,
        authorAccountId: user.id,
      });
      if (!result.ok) {
        sendJson(response, 400, {
          message: RELEASE_MESSAGES.tagExists,
          fieldErrors: { tag: RELEASE_MESSAGES.tagExists },
        });
        return true;
      }
      sendJson(response, 201, {
        repository: await withOwner(repository),
        release: result.release,
        canWrite,
      });
      return true;
    }

    // GET /api/repositories/:owner/:name/releases/:tag — one published release.
    if (method !== "GET") return false;
    const release = await orgStore.getRepositoryRelease(repository.id, decodeSegment(detailMatch[3]));
    if (!release) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }
    sendJson(response, 200, {
      repository: await withOwner(repository),
      release,
      canWrite,
    });
    return true;
  };
}
