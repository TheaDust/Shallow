import { useCallback, useEffect, useState } from "react";

import { ApiError } from "../lib/api";
import {
  fetchRepositoryPullRequest,
  fetchRepositoryPullRequests,
  missingPullRequestContext,
  type PullRequestPayload,
  type PullRequestsPayload,
} from "../lib/pull-requests-api";
import type { RepositoryContext } from "../lib/repositories-api";

/**
 * Readers of the pull-request views. A refusal keeps the server's answer apart:
 * `denied` is a signed-in viewer without permission, while `missing` is an
 * unknown repository or number (a number carries its repository context so the
 * page can show it as absent).
 */
export type PullRequestResource<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "missing"; context: RepositoryContext | null }
  | { status: "denied" }
  | { status: "error" };

function toFailureState<T>(error: unknown): PullRequestResource<T> {
  const status = error instanceof ApiError ? error.status : 0;
  if (status === 403) return { status: "denied" };
  if (status === 404) return { status: "missing", context: missingPullRequestContext(error) };
  return { status: "error" };
}

/** Every pull request of the repository, re-read on `reload`. */
export function useRepositoryPullRequests(
  owner: string,
  name: string,
): {
  state: PullRequestResource<PullRequestsPayload>;
  reload(): void;
} {
  const [state, setState] = useState<PullRequestResource<PullRequestsPayload>>({
    status: "loading",
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    fetchRepositoryPullRequests(owner, name).then(
      (value) => {
        if (active) setState({ status: "ready", value });
      },
      (error: unknown) => {
        if (active) setState(toFailureState<PullRequestsPayload>(error));
      },
    );
    return () => {
      active = false;
    };
  }, [owner, name, version]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);
  return { state, reload };
}

/**
 * One pull request detail. `setValue` stores the answer of a successful write,
 * so the page shows the same persisted record the list would read after a
 * refresh.
 */
export function useRepositoryPullRequest(
  owner: string,
  name: string,
  number: number,
): {
  state: PullRequestResource<PullRequestPayload>;
  setValue(value: PullRequestPayload): void;
  reload(): void;
} {
  const [state, setState] = useState<PullRequestResource<PullRequestPayload>>({
    status: "loading",
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    fetchRepositoryPullRequest(owner, name, number).then(
      (value) => {
        if (active) setState({ status: "ready", value });
      },
      (error: unknown) => {
        if (active) setState(toFailureState<PullRequestPayload>(error));
      },
    );
    return () => {
      active = false;
    };
  }, [owner, name, number, version]);

  const setValue = useCallback((value: PullRequestPayload) => {
    setState({ status: "ready", value });
  }, []);
  const reload = useCallback(() => setVersion((current) => current + 1), []);

  return { state, setValue, reload };
}
