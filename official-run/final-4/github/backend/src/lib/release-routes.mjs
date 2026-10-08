// HTTP surface of the repository releases (REQ-4-5).
//
// The list and every detail view apply the shared repository read rule, so a
// visitor can read the published releases of a public repository. Publishing
// needs the write rule (Write, Maintain, Admin, or organization Owner) and is
// re-checked here: a duplicate tag or an unknown target branch is refused with
// the exact message the form displays and writes nothing.

import { normalizeText } from "./auth-rules.mjs";
import { readJson, sendJson } from "./http.mjs";
import { ORG_MESSAGES } from "./org-rules.mjs";
import { RELEASE_MESSAGES, validateReleaseTag } from "./release-rules.mjs";
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

    // GET .../releases — the published releases of this repository plus whether
    // the caller may publish another one. Reading stays open with the
    // repository, so a visitor sees the list and never the publishing control.
    if (listMatch && method === "GET") {
      sendJson(response, 200, {
        repository: await withOwner(repository),
        defaultBranch: repository.defaultBranch ?? "main",
        releases: await orgStore.listReleases(repository.id),
        canPublish: await orgStore.canWriteRepository(repository, user?.id ?? null),
      });
      return true;
    }

    // POST .../releases — publish one release on an existing branch. The tag is
    // unique inside the repository; a duplicate reports "Tag already exists"
    // and creates no second release.
    if (listMatch && method === "POST") {
      if (!user) {
        sendJson(response, 401, { message: "Not signed in" });
        return true;
      }
      if (!(await orgStore.canWriteRepository(repository, user.id))) {
        sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
        return true;
      }
      const body = await readJson(request).catch(() => ({}));
      const tag = normalizeText(body.tag);
      const branch = normalizeText(body.branch) || repository.defaultBranch || "main";
      if (!validateReleaseTag(tag)) {
        sendJson(response, 400, {
          message: "Validation failed",
          fieldErrors: { tag: RELEASE_MESSAGES.tagRequired },
        });
        return true;
      }
      const result = await orgStore.createRelease({
        repositoryId: repository.id,
        tag,
        title: normalizeText(body.title),
        description: typeof body.description === "string" ? body.description : "",
        branch,
        authorName: user.username,
        authorAccountId: user.id,
      });
      if (!result.ok) {
        const message =
          result.reason === "duplicate-tag"
            ? RELEASE_MESSAGES.tagExists
            : RELEASE_MESSAGES.branchInvalid;
        const field = result.reason === "duplicate-tag" ? "tag" : "branch";
        sendJson(response, 400, { message, fieldErrors: { [field]: message } });
        return true;
      }
      sendJson(response, 201, { release: result.release });
      return true;
    }

    // GET .../releases/:tag — one published release; an unknown tag is a 404.
    if (detailMatch && method === "GET") {
      const release = await orgStore.getRelease(repository.id, decodeSegment(detailMatch[3]));
      if (!release) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      sendJson(response, 200, { repository: await withOwner(repository), release });
      return true;
    }

    return false;
  };
}
