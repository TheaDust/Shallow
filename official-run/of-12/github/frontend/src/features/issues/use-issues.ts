import { useCallback, useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import {
  fetchRepositoryIssue,
  fetchRepositoryIssues,
  type IssueDetailPayload,
  type IssueListPayload,
} from "./issue-api";

/**
 * Load states of an issue read (REQ-5-1). `missing` is a number or a repository
 * that does not exist, `denied` a repository the caller may not read; neither
 * ever renders stored issue content.
 */
export type IssueLoadState = "idle" | "loading" | "ready" | "missing" | "denied" | "failed";

function classify(error: unknown): IssueLoadState {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return "denied";
    if (error.status === 404) return "missing";
  }
  return "failed";
}

export interface IssueListLoad {
  state: IssueLoadState;
  payload: IssueListPayload | null;
  reload(): void;
}

/** The issue rows of one repository (REQ-5-1-1). */
export function useRepositoryIssues(owner: string, name: string, enabled: boolean): IssueListLoad {
  const [state, setState] = useState<IssueLoadState>("idle");
  const [payload, setPayload] = useState<IssueListPayload | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    setState("loading");
    fetchRepositoryIssues(owner, name)
      .then((result) => {
        if (!active) return;
        setPayload(result);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setPayload(null);
        setState(classify(error));
      });
    return () => {
      active = false;
    };
  }, [owner, name, enabled, version]);

  return { state, payload, reload };
}

export interface IssueDetailLoad {
  state: IssueLoadState;
  payload: IssueDetailPayload | null;
  reload(): void;
}

/** One issue of a repository with its discussion (REQ-5-1-2). */
export function useRepositoryIssue(
  owner: string,
  name: string,
  number: string,
  enabled: boolean,
): IssueDetailLoad {
  const [state, setState] = useState<IssueLoadState>("idle");
  const [payload, setPayload] = useState<IssueDetailPayload | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    setState("loading");
    fetchRepositoryIssue(owner, name, number)
      .then((result) => {
        if (!active) return;
        setPayload(result);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setPayload(null);
        setState(classify(error));
      });
    return () => {
      active = false;
    };
  }, [owner, name, number, enabled, version]);

  return { state, payload, reload };
}
