// Persistence of repository releases (REQ-4-5).
//
// A release is identified by its repository plus its tag: the tag is unique
// inside that repository only, and it may be reused by another repository. The
// record stores the selected existing branch together with the published text,
// so the detail view, the list and a reload all read the same stored release.
// A rejected publication (duplicate tag, unknown branch) writes nothing.

import { randomUUID } from "node:crypto";

function normalize(state) {
  if (!Array.isArray(state.releases)) state.releases = [];
  return state;
}

/** Public shape of one release: everything the list and the detail display. */
function describeRelease(release) {
  return {
    tag: release.tag,
    title: release.title,
    description: release.description ?? "",
    branch: release.branch,
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
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
        .map(describeRelease);
    },

    /** One release of one repository, found by its exact tag. */
    async getRelease(repositoryId, tag) {
      const state = await readState();
      const release = state.releases.find(
        (entry) => entry.repositoryId === repositoryId && entry.tag === tag,
      );
      return release ? describeRelease(release) : null;
    },

    /**
     * Publishes one release on an existing branch of the same repository. The
     * duplicate-tag and unknown-branch checks happen inside the same store
     * update that writes the record, so a rejected submission leaves no partial
     * release behind.
     */
    async createRelease({
      repositoryId,
      tag,
      title,
      description,
      branch,
      authorName,
      authorAccountId,
    }) {
      let result = { ok: false, reason: "duplicate-tag", release: null };
      const now = new Date().toISOString();
      await store.update((draft) => {
        normalize(draft);
        if (
          draft.releases.some(
            (entry) => entry.repositoryId === repositoryId && entry.tag === tag,
          )
        ) {
          result = { ok: false, reason: "duplicate-tag", release: null };
          return;
        }
        const exists = draft.branches.some(
          (entry) => entry.repositoryId === repositoryId && entry.name === branch,
        );
        if (!exists) {
          result = { ok: false, reason: "branch-missing", release: null };
          return;
        }
        const release = {
          id: `release-${randomUUID()}`,
          repositoryId,
          tag,
          title,
          description,
          branch,
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
