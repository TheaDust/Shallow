import { useCallback, useEffect, useState } from "react";

import {
  fetchRepositoryOverview,
  missingFileContext,
  type RepositoryContext,
  type RepositoryOverview,
} from "../lib/repositories-api";

export type RepositoryLoadState =
  | { status: "loading" }
  | { status: "ready"; repository: RepositoryOverview }
  | { status: "missing"; context: RepositoryContext | null }
  | { status: "denied" }
  | { status: "error" };

export interface RepositoryOverviewLoader {
  state: RepositoryLoadState;
  reload(): void;
}

/**
 * Loads the identity, visibility and viewer permissions of one repository from
 * the server; `reload` re-reads it after a change so every view that shares this
 * data (the overview marker, settings, Danger Zone) updates together.
 */
export interface RepositoryViewOptions {
  /** Branch of the view; the repository default branch is read when omitted. */
  branch?: string;
  /** Directory path of the view; the branch root is read when omitted. */
  path?: string;
}

/**
 * Loads one directory of one branch together with the repository identity,
 * visibility and viewer permissions; `reload` re-reads it after a change so
 * every view that shares this data (the overview marker, settings, Danger Zone)
 * updates together.
 */
export function useRepositoryOverview(
  owner: string,
  name: string,
  options: RepositoryViewOptions = {},
): RepositoryOverviewLoader {
  const branch = options.branch ?? "";
  const path = options.path ?? "";
  const [state, setState] = useState<RepositoryLoadState>({ status: "loading" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    fetchRepositoryOverview(owner, name, branch, path)
      .then(
        (repository) => {
          if (active) setState({ status: "ready", repository });
        },
        (error: unknown) => {
          if (!active) return;
          const status = (error as { status?: number }).status;
          // A signed-in viewer learns that the repository exists but is not
          // readable; an anonymous viewer keeps the plain not-found answer. A
          // readable repository without that path carries its context along.
          setState(
            status === 403
              ? { status: "denied" }
              : status === 404
                ? { status: "missing", context: missingFileContext(error) }
                : { status: "error" },
          );
        },
      );
    return () => {
      active = false;
    };
  }, [owner, name, branch, path, version]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);

  return { state, reload };
}
