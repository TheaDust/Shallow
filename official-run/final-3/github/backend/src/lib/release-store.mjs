// Persistence of repository releases (REQ-4-5).
//
// A release belongs to one repository and carries a tag that is unique inside
// that repository only, its title, its description and the existing branch it
// targets. Publishing one writes a single stored record, so a rejected tag
// leaves the collection untouched.

import { randomUUID } from "node:crypto";

const COLLECTION = "releases";

function normalize(state) {
  if (!Array.isArray(state[COLLECTION])) state[COLLECTION] = [];
  return state;
}

/** Public shape of one release, without the repository it belongs to. */
function describeRelease(release) {
  return {
    id: release.id,
    tag: release.tag,
    title: release.title,
    description: release.description ?? "",
    targetBranch: release.targetBranch,
    author: release.authorName,
    createdAt: release.createdAt,
  };
}

export function createReleaseStore(store) {
  async function readState() {
    return normalize(await store.read());
  }

  return {
    /** Every release of one repository, newest first. */
    async listReleases(repositoryId) {
      const state = await readState();
      return state.releases
        .filter((entry) => entry.repositoryId === repositoryId)
        .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")))
        .map(describeRelease);
    },

    /** One release of one repository by its exact tag, or null. */
    async getRelease(repositoryId, tag) {
      const state = await readState();
      const release = state.releases.find(
        (entry) => entry.repositoryId === repositoryId && entry.tag === tag,
      );
      return release ? describeRelease(release) : null;
    },

    /**
     * Publishes one release. A tag the repository already uses is refused
     * without writing, so a repeated submission never creates a second record
     * and never changes the stored one.
     */
    async createRelease({ repositoryId, tag, title, description, targetBranch, authorName, authorAccountId }) {
      let result = { ok: false, reason: "duplicate", release: null };
      const now = new Date().toISOString();
      await store.update((draft) => {
        normalize(draft);
        if (draft.releases.some((entry) => entry.repositoryId === repositoryId && entry.tag === tag)) {
          return;
        }
        const release = {
          id: `release-${randomUUID()}`,
          repositoryId,
          tag,
          title,
          description: description ?? "",
          targetBranch,
          authorName,
          authorAccountId: authorAccountId ?? null,
          createdAt: now,
        };
        draft.releases.push(release);
        result = { ok: true, reason: "ok", release: describeRelease(release) };
      });
      return result;
    },
  };
}
