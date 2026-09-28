import { useCallback, useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import { fetchRepository } from "../../lib/org-api";
import { fetchPersonalRepository, RepoDetail, RepoOwnerType } from "../../lib/repo-api";

export type RepoDetailStatus = "loading" | "ready" | "denied" | "notfound";

export interface RepoDetailState {
  status: RepoDetailStatus;
  repository: RepoDetail | null;
}

/**
 * Loads one repository detail through the route's owner type (account or
 * organization) on the requested branch (defaults to the default branch).
 * Access is validated server-side against the current session.
 */
export function useRepoDetail(
  ownerType: RepoOwnerType,
  ownerName: string,
  repoName: string,
  branch?: string,
): RepoDetailState & { refresh: () => Promise<void> } {
  const [state, setState] = useState<RepoDetailState>({ status: "loading", repository: null });

  const refresh = useCallback(async () => {
    try {
      const load =
        ownerType === "account"
          ? fetchPersonalRepository(ownerName, repoName, branch)
          : fetchRepository(ownerName, repoName, branch);
      const repository = await load;
      setState({ status: "ready", repository });
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setState({ status: "denied", repository: null });
      } else {
        setState({ status: "notfound", repository: null });
      }
    }
  }, [ownerType, ownerName, repoName, branch]);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", repository: null });
    const load =
      ownerType === "account"
        ? fetchPersonalRepository(ownerName, repoName, branch)
        : fetchRepository(ownerName, repoName, branch);
    load
      .then((repository) => {
        if (!cancelled) setState({ status: "ready", repository });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) {
          setState({ status: "denied", repository: null });
        } else if (error instanceof ApiError && error.status === 404) {
          setState({ status: "notfound", repository: null });
        } else {
          setState({ status: "notfound", repository: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ownerType, ownerName, repoName, branch]);

  return { ...state, refresh };
}
