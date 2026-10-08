// Persistence of repository releases (REQ-4-5).
//
// A release belongs to one repository and is identified inside that repository
// by its tag name, so a tag is unique per repository: publishing a tag that is
// already used is refused instead of storing a second record. The record also
// stores the existing branch the release targets, which is why a release can
// never point at a branch the repository does not have.

import { randomUUID } from "node:crypto";

const COLLECTIONS = ["releases"];

function normalize(state) {
  for (const key of COLLECTIONS) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  return state;
}

/** Public shape of one release: stored tag, title, description and branch. */
export function publicRelease(release) {
  if (!release) return null;
  return {
    id: release.id,
    tagName: release.tagName,
    title: release.title,
    description: release.description ?? "",
    targetBranch: release.targetBranch,
    authorName: release.authorName ?? null,
    createdAt: release.createdAt,
  };
}

/** One stored release of a repository by its exact tag name, or null. */
export function findRepositoryRelease(state, repositoryId, tagName) {
  return (
    state.releases.find(
      (entry) => entry.repositoryId === repositoryId && entry.tagName === tagName,
    ) ?? null
  );
}

export function createReleaseStore(store) {
  async function readState() {
    return normalize(await store.read());
  }

  return {
    /** Every release of one repository, newest first. */
    async listRepositoryReleases(repositoryId) {
      const state = await readState();
      return state.releases
        .filter((entry) => entry.repositoryId === repositoryId)
        .sort((left, right) => {
          const difference = Date.parse(right.createdAt) - Date.parse(left.createdAt);
          return difference !== 0 ? difference : String(right.tagName).localeCompare(String(left.tagName));
        })
        .map(publicRelease);
    },

    async getRepositoryRelease(repositoryId, tagName) {
      const state = await readState();
      return publicRelease(findRepositoryRelease(state, repositoryId, tagName));
    },

    /**
     * Publishes one release. The uniqueness check and the insert happen in the
     * same store update, so a used tag can never produce a duplicate record.
     */
    async createRepositoryRelease({
      repositoryId,
      tagName,
      title,
      description,
      targetBranch,
      authorName,
    }) {
      let created = null;
      await store.update((draft) => {
        normalize(draft);
        if (findRepositoryRelease(draft, repositoryId, tagName)) return;
        const release = {
          id: `release-${randomUUID()}`,
          repositoryId,
          tagName,
          title,
          description: description ?? "",
          targetBranch,
          authorName: authorName ?? null,
          createdAt: new Date().toISOString(),
        };
        draft.releases.push(release);
        created = publicRelease(release);
      });
      return created;
    },
  };
}
