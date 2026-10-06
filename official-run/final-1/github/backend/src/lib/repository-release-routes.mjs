// HTTP surface of repository releases (REQ-4-5): the released tags of one
// repository, one release detail and the publication of a new release.
//
// Every rule is re-validated here: the session cookie is the only trusted
// identity source, the list and the detail apply the shared repository read
// rule, and publishing re-checks the write permission, the target branch and the
// uniqueness of the tag before anything is stored.

import { normalizeText } from "./auth-rules.mjs";
import { readJson, sendJson } from "./http.mjs";
import { ORG_MESSAGES, RELEASE_MESSAGES, validateReleaseTag } from "./org-rules.mjs";
import { publicRepository } from "./org-store.mjs";

const RELEASES_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/releases$/;
const RELEASE_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/releases\/([^/]+)$/;

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function createRepositoryReleaseRoutes({ orgStore, findRepository, describeOwner, currentUser }) {
  return async function handleRepositoryReleases(request, response, url, method) {
    const { pathname } = url;
    if (!pathname.startsWith("/api/repositories/")) return false;

    const listMatch = pathname.match(RELEASES_PATH);
    const detailMatch = pathname.match(RELEASE_PATH);
    if (!listMatch && !detailMatch) return false;

    const match = listMatch ?? detailMatch;
    const repository = await findRepository(decodeSegment(match[1]), decodeSegment(match[2]));
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }

    const user = await currentUser(request);
    const repositoryPayload = {
      ...publicRepository(repository),
      owner: await describeOwner(repository.ownerType, repository.ownerId),
    };

    // GET /api/repositories/:owner/:name/releases — every released tag of this
    // repository. Reading follows the repository read rule, so a visitor reads
    // the releases of a public repository.
    if (listMatch && method === "GET") {
      if (!(await orgStore.canReadRepository(repository, user?.id ?? null))) {
        sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
        return true;
      }
      sendJson(response, 200, {
        repository: repositoryPayload,
        releases: await orgStore.listRepositoryReleases(repository.id),
        canWrite: await orgStore.canWriteRepository(repository, user?.id ?? null),
      });
      return true;
    }

    // POST /api/repositories/:owner/:name/releases — publish one release for an
    // existing branch. The write permission is required here even though the
    // control is not rendered for a reader, and an already used tag is refused
    // with its own message without storing a second release.
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
      const tagName = normalizeText(body.tagName ?? body.tag);
      const title = normalizeText(body.title);
      const description = typeof body.description === "string" ? body.description : "";
      const targetBranch = normalizeText(body.targetBranch ?? body.branch);

      const fieldErrors = {};
      if (!tagName) fieldErrors.tagName = RELEASE_MESSAGES.tagNameRequired;
      else if (!validateReleaseTag(tagName)) fieldErrors.tagName = RELEASE_MESSAGES.tagNameInvalid;
      if (!title) fieldErrors.title = RELEASE_MESSAGES.titleRequired;
      const branches = await orgStore.listRepositoryBranches(repository.id);
      const branchNames = branches ? branches.branches.map((branch) => branch.name) : [];
      if (!targetBranch || !branchNames.includes(targetBranch)) {
        fieldErrors.targetBranch = RELEASE_MESSAGES.targetBranchInvalid;
      }
      if (Object.keys(fieldErrors).length > 0) {
        sendJson(response, 400, { message: "Validation failed", fieldErrors });
        return true;
      }

      const result = await orgStore.createRepositoryRelease({
        repositoryId: repository.id,
        tagName,
        title,
        description,
        targetBranch,
        authorName: user.username,
        authorAccountId: user.id,
      });
      if (!result.ok) {
        const message =
          result.reason === "duplicate"
            ? RELEASE_MESSAGES.tagExists
            : result.reason === "branch-missing"
              ? RELEASE_MESSAGES.targetBranchInvalid
              : "Validation failed";
        sendJson(response, 400, {
          message,
          fieldErrors: {
            [result.reason === "duplicate" ? "tagName" : "targetBranch"]: message,
          },
        });
        return true;
      }
      sendJson(response, 201, { repository: repositoryPayload, release: result.release });
      return true;
    }

    // GET /api/repositories/:owner/:name/releases/:tag — one released tag with
    // its title, description and target branch.
    if (detailMatch && method === "GET") {
      if (!(await orgStore.canReadRepository(repository, user?.id ?? null))) {
        sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
        return true;
      }
      const release = await orgStore.getRepositoryRelease(
        repository.id,
        decodeSegment(detailMatch[3]),
      );
      if (!release) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      sendJson(response, 200, {
        repository: repositoryPayload,
        release,
        canWrite: await orgStore.canWriteRepository(repository, user?.id ?? null),
      });
      return true;
    }

    return false;
  };
}
