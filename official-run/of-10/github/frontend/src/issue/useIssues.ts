import { useCallback, useEffect, useState } from "react";

import { ApiError } from "../lib/api";
import {
  fetchRepositoryIssue,
  fetchRepositoryIssues,
  missingIssueContext,
  type RepositoryIssuePayload,
  type RepositoryIssuesPayload,
} from "../lib/issues-api";
import type { RepositoryContext } from "../lib/repositories-api";

/**
 * Readers of the issue views. A refusal keeps the server's answer apart: `denied`
 * is a signed-in viewer without permission, while `missing` is an unknown
 * repository or issue number (an issue number carries its repository context so
 * the page can show it as absent).
 */
export type IssuesResource<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "missing"; context: RepositoryContext | null }
  | { status: "denied" }
  | { status: "error" };

function toFailureState<T>(error: unknown): IssuesResource<T> {
  const status = error instanceof ApiError ? error.status : 0;
  if (status === 403) return { status: "denied" };
  if (status === 404) return { status: "missing", context: missingIssueContext(error) };
  return { status: "error" };
}

/** Every issue of the repository, re-read on `reload`. */
export function useRepositoryIssues(owner: string, name: string): {
  state: IssuesResource<RepositoryIssuesPayload>;
  reload(): void;
} {
  const [state, setState] = useState<IssuesResource<RepositoryIssuesPayload>>({ status: "loading" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    fetchRepositoryIssues(owner, name).then(
      (value) => {
        if (active) setState({ status: "ready", value });
      },
      (error: unknown) => {
        if (active) setState(toFailureState<RepositoryIssuesPayload>(error));
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
 * One issue detail. `setValue` stores the answer of a successful write, so the
 * page shows the same persisted record the list would read after a refresh.
 */
export function useRepositoryIssue(
  owner: string,
  name: string,
  number: number,
): {
  state: IssuesResource<RepositoryIssuePayload>;
  setValue(value: RepositoryIssuePayload): void;
  reload(): void;
} {
  const [state, setState] = useState<IssuesResource<RepositoryIssuePayload>>({ status: "loading" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    fetchRepositoryIssue(owner, name, number).then(
      (value) => {
        if (active) setState({ status: "ready", value });
      },
      (error: unknown) => {
        if (active) setState(toFailureState<RepositoryIssuePayload>(error));
      },
    );
    return () => {
      active = false;
    };
  }, [owner, name, number, version]);

  const setValue = useCallback((value: RepositoryIssuePayload) => {
    setState({ status: "ready", value });
  }, []);
  const reload = useCallback(() => setVersion((current) => current + 1), []);

  return { state, setValue, reload };
}
