// Persistence of repository releases (REQ-4-5).
//
// A release is identified by its repository plus its tag: the tag is unique
// inside that repository only. Every release is associated with one existing
// branch the publishing user selected. Creating a release with a tag the
// repository already published writes nothing at all, so a rejected attempt
// never leaves a second record behind.

import { randomUUID } from "node:crypto";

const COLLECTIONS = ["releases"];

function normalize(state) {
  for (const key of COLLECTIONS) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  return state;
}

/** Public shape of one published release, as the views read it. */
export function publicRelease(release) {
  if (!release) return null;
  return {
    id: release.id,
    tag: release.tag,
    title: release.title ?? "",
    description: release.description ?? "",
    targetBranch: release.targetBranch,
    author: release.authorName ?? "",
    publishedAt: release.publishedAt,
  };
}

export function createReleaseStore(store) {
  async function readState() {
    return normalize(await store.read());
  }

  return {
    /** Every published release of one repository, newest first. */
    async listRepositoryReleases(repositoryId) {
      const state = await readState();
      return state.releases
        .filter((entry) => entry.repositoryId === repositoryId)
        .sort((left, right) => {
          const difference = Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
          return difference !== 0 ? difference : 0;
        })
        .map(publicRelease);
    },

    /** One release of the exact tag, or null when the repository has none. */
    async getRepositoryRelease(repositoryId, tag) {
      const state = await readState();
      const release = state.releases.find(
        (entry) => entry.repositoryId === repositoryId && entry.tag === tag,
      );
      return release ? publicRelease(release) : null;
    },

    /**
     * Publishes one release for an unused tag. The tag check and the write
     * happen in the same store update, so two attempts on one tag can never
     * both create a release.
     */
    async createRepositoryRelease({
      repositoryId,
      tag,
      title,
      description,
      targetBranch,
      authorName,
      authorAccountId,
    }) {
      let result = { ok: false, reason: "tag-exists", release: null };
      const publishedAt = new Date().toISOString();
      await store.update((draft) => {
        normalize(draft);
        const exists = draft.releases.some(
          (entry) => entry.repositoryId === repositoryId && entry.tag === tag,
        );
        if (exists) return;
        const release = {
          id: `release-${randomUUID()}`,
          repositoryId,
          tag,
          title: title ?? "",
          description: description ?? "",
          targetBranch,
          authorName: authorName ?? "",
          authorAccountId: authorAccountId ?? null,
          publishedAt,
        };
        draft.releases.push(release);
        result = { ok: true, reason: "ok", release: publicRelease(release) };
      });
      return result;
    },
  };
}
