// Persisted repository releases (REQ-4-5). A release associates one tag with an
// existing branch of the same repository; the tag is unique inside that
// repository, so the records are the single source both the list and the detail
// view read, and publishing can never create a second release for one tag.

import { randomUUID } from "node:crypto";

/** One stored release as the list and the detail view read it. */
export function publicRelease(release) {
  if (!release) return null;
  return {
    id: release.id,
    tagName: release.tagName,
    title: release.title,
    description: release.description ?? "",
    targetBranch: release.targetBranch,
    author: release.authorName,
    createdAt: release.createdAt,
  };
}

export function createReleaseStore(store) {
  return {
    /** Releases of one repository, newest first. */
    async listRepositoryReleases(repositoryId) {
      const state = await store.read();
      return (state.releases ?? [])
        .filter((entry) => entry.repositoryId === repositoryId)
        .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
        .map(publicRelease);
    },

    /** One released tag of one repository, or null when it was never used. */
    async getRepositoryRelease(repositoryId, tagName) {
      const state = await store.read();
      return publicRelease(
        (state.releases ?? []).find(
          (entry) => entry.repositoryId === repositoryId && entry.tagName === tagName,
        ),
      );
    },

    /**
     * Appends one release for an existing branch of the repository. An already
     * used tag and a missing target branch are rejected inside the same store
     * update, so a refused publication writes nothing at all.
     */
    async createRepositoryRelease({
      repositoryId,
      tagName,
      title,
      description,
      targetBranch,
      authorName,
      authorAccountId,
    }) {
      let result = { ok: false, reason: "repository-missing", release: null };
      const now = new Date().toISOString();
      await store.update((draft) => {
        if (!Array.isArray(draft.releases)) draft.releases = [];
        const repository = (draft.repositories ?? []).find((entry) => entry.id === repositoryId);
        if (!repository) return;
        const branchExists = (draft.branches ?? []).some(
          (entry) => entry.repositoryId === repositoryId && entry.name === targetBranch,
        );
        if (!branchExists) {
          result = { ok: false, reason: "branch-missing", release: null };
          return;
        }
        if (
          draft.releases.some(
            (entry) => entry.repositoryId === repositoryId && entry.tagName === tagName,
          )
        ) {
          result = { ok: false, reason: "duplicate", release: null };
          return;
        }
        const release = {
          id: `release-${randomUUID()}`,
          repositoryId,
          tagName,
          title,
          description: description ?? "",
          targetBranch,
          authorName,
          authorAccountId: authorAccountId ?? null,
          createdAt: now,
        };
        draft.releases.push(release);
        result = { ok: true, reason: "ok", release: publicRelease(release) };
      });
      return result;
    },
  };
}
