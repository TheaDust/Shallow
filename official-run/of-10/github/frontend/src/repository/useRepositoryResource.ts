import { useEffect, useState } from "react";

import { ApiError } from "../lib/api";
import { missingFileContext, type RepositoryContext } from "../lib/repositories-api";

export type RepositoryResource<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "missing"; context: RepositoryContext | null }
  | { status: "denied" }
  | { status: "error" };

/**
 * Reads one server resource of a repository page. The status keeps the server's
 * refusal apart: `denied` is a signed-in viewer without permission, `missing` is
 * an unknown address — or a readable repository that has no such file on the
 * current branch, which arrives with the repository context.
 */
export function useRepositoryResource<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
): RepositoryResource<T> {
  const [state, setState] = useState<RepositoryResource<T>>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    load().then(
      (value) => {
        if (active) setState({ status: "ready", value });
      },
      (error: unknown) => {
        if (!active) return;
        const status = error instanceof ApiError ? error.status : 0;
        if (status === 403) setState({ status: "denied" });
        else if (status === 404) setState({ status: "missing", context: missingFileContext(error) });
        else setState({ status: "error" });
      },
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
