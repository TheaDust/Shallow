// HTTP surface of the repository releases (REQ-4-5).
//
// Reading applies the shared repository read rule, so a visitor may open the
// published release details of a readable repository. Publishing needs the
// write rule (Write, Maintain, Admin or organization Owner) and is re-checked
// here; a rejected request writes nothing.

import { normalizeText } from "./auth-rules.mjs";
import { readJson, sendJson } from "./http.mjs";
import { ORG_MESSAGES, RELEASE_MESSAGES } from "./org-rules.mjs";
import { publicRepository } from "./org-store.mjs";

const RELEASES_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/releases$/;
const RELEASE_PATH = /^\/api\/repositories\/([^/]+)\/([^/]+)\/releases\/([^/]+)$/;
const MAX_DESCRIPTION = 65536;

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

  return async function handleRepositoryReleases(request, response, url, method) {
    const { pathname } = url;
    if (!pathname.startsWith("/api/repositories/")) return false;

    const listMatch = pathname.match(RELEASES_PATH);
    const releaseMatch = listMatch ? null : pathname.match(RELEASE_PATH);
    const match = listMatch ?? releaseMatch;
    if (!match) return false;

    const repository = await findRepository(decodeSegment(match[1]), decodeSegment(match[2]));
    if (!repository) {
      sendJson(response, 404, { error: "Not found" });
      return true;
    }

    const user = await currentUser(request);
    if (!(await orgStore.canReadRepository(repository, user?.id ?? null))) {
      sendJson(response, 403, { message: ORG_MESSAGES.accessDenied });
      return true;
    }

    // GET .../releases — the published releases of this repository plus whether
    // the caller may publish one, so the page can offer the entry to a writer
    // only while visitors still read the details.
    if (listMatch && method === "GET") {
      sendJson(response, 200, {
        repository: await withOwner(repository),
        releases: await orgStore.listRepositoryReleases(repository.id),
        canWrite: await orgStore.canWriteRepository(repository, user?.id ?? null),
      });
      return true;
    }

    // POST .../releases — one release on an existing branch. The tag is unique
    // inside the repository, so an already used tag is refused.
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
      const tagName = normalizeText(body.tagName);
      const title = normalizeText(body.title);
      const description = typeof body.description === "string" ? body.description : "";
      const requestedBranch = normalizeText(body.targetBranch);
      const listed = await orgStore.listRepositoryBranches(repository.id);
      const targetBranch = requestedBranch || listed?.defaultBranch || "main";

      const fieldErrors = {};
      if (!tagName) fieldErrors.tagName = RELEASE_MESSAGES.tagRequired;
      if (!title) fieldErrors.title = RELEASE_MESSAGES.titleRequired;
      if (description.length > MAX_DESCRIPTION) {
        fieldErrors.description = RELEASE_MESSAGES.descriptionTooLong;
      }
      if (!listed?.branches.some((entry) => entry.name === targetBranch)) {
        fieldErrors.targetBranch = RELEASE_MESSAGES.targetBranchInvalid;
      }
      if (Object.keys(fieldErrors).length > 0) {
        sendJson(response, 400, { message: "Validation failed", fieldErrors });
        return true;
      }

      const release = await orgStore.createRepositoryRelease({
        repositoryId: repository.id,
        tagName,
        title,
        description,
        targetBranch,
        authorName: user.username,
      });
      if (!release) {
        sendJson(response, 400, {
          message: RELEASE_MESSAGES.tagExists,
          fieldErrors: { tagName: RELEASE_MESSAGES.tagExists },
        });
        return true;
      }
      sendJson(response, 201, { repository: await withOwner(repository), release });
      return true;
    }

    // GET .../releases/:tag — one readable release detail.
    if (releaseMatch && method === "GET") {
      const release = await orgStore.getRepositoryRelease(
        repository.id,
        decodeSegment(releaseMatch[3]),
      );
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
