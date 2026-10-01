import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "../../lib/api";
import {
  fetchReadableRepositories,
  fetchRepositoryOverview,
  type RepositoryOverview,
  type RepositorySummary,
} from "./repository-api";

export type RepositoryLoadState = "loading" | "ready" | "denied" | "missing" | "failed";

export interface RepositoryLoad {
  state: RepositoryLoadState;
  repository: RepositoryOverview | null;
  /** Re-reads the overview, so a write can refresh the branch list (REQ-4-3-2). */
  reload(): void;
}

/**
 * Loads one repository overview for the page that displays it. A private
 * repository the caller may not read is reported as `denied` and never renders
 * repository content (REQ-3-3). `reload` re-reads the same repository, which a
 * branch write uses to refresh the reported branches and the default branch.
 */
export function useRepositoryOverview(owner: string, name: string): RepositoryLoad {
  const [state, setState] = useState<RepositoryLoadState>("loading");
  const [repository, setRepository] = useState<RepositoryOverview | null>(null);
  const [version, setVersion] = useState(0);
  const identity = `${owner}/${name}`;
  const loadedIdentity = useRef(identity);

  const reload = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    // Only another repository resets the view: a reload after a write keeps the
    // current page rendered until the refreshed overview arrives, so the branch
    // selector and the file list never disappear mid-interaction.
    if (loadedIdentity.current !== identity) {
      loadedIdentity.current = identity;
      setState("loading");
      setRepository(null);
    }
    fetchRepositoryOverview(owner, name)
      .then((result) => {
        if (!active) return;
        setRepository(result);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) setState("denied");
        else if (error instanceof ApiError && error.status === 404) setState("missing");
        else setState("failed");
      });
    return () => {
      active = false;
    };
  }, [owner, name, identity, version]);

  return { state, repository, reload };
}

/**
 * Loads the repositories the current caller may read (REQ-3) for the home page
 * and the signed-in workspace. A failing list request leaves the list empty
 * instead of blocking the page, and the list is reloaded whenever the session
 * changes so a signed-out visitor stops seeing private repositories.
 */
export function useReadableRepositories(reloadKey: string | null): RepositorySummary[] {
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);

  useEffect(() => {
    let active = true;
    fetchReadableRepositories()
      .then((result) => {
        if (active) setRepositories(result);
      })
      .catch(() => {
        if (active) setRepositories([]);
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  return repositories;
}
