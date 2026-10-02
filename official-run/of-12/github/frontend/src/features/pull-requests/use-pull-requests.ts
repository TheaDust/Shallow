import { useCallback, useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import {
  fetchRepositoryPullRequest,
  fetchRepositoryPullRequests,
  type PullRequestListPayload,
  type PullRequestPayload,
} from "./pull-request-api";

/**
 * Load states of a pull-request read (REQ-6). `missing` is a number or a
 * repository that does not exist, `denied` a repository the caller may not
 * read; neither ever renders stored content.
 */
export type PullRequestLoadState = "idle" | "loading" | "ready" | "missing" | "denied" | "failed";

function classify(error: unknown): PullRequestLoadState {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return "denied";
    if (error.status === 404) return "missing";
  }
  return "failed";
}

export interface PullRequestListLoad {
  state: PullRequestLoadState;
  payload: PullRequestListPayload | null;
  reload(): void;
}

/** The pull-request rows of one repository (REQ-6). */
export function useRepositoryPullRequests(owner: string, name: string, enabled: boolean): PullRequestListLoad {
  const [state, setState] = useState<PullRequestLoadState>("idle");
  const [payload, setPayload] = useState<PullRequestListPayload | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    setState("loading");
    fetchRepositoryPullRequests(owner, name)
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

export interface PullRequestDetailLoad {
  state: PullRequestLoadState;
  payload: PullRequestPayload | null;
  reload(): void;
}

/** One pull request of a repository with its discussion and checks (REQ-6-1). */
export function useRepositoryPullRequest(
  owner: string,
  name: string,
  number: string,
  enabled: boolean,
): PullRequestDetailLoad {
  const [state, setState] = useState<PullRequestLoadState>("idle");
  const [payload, setPayload] = useState<PullRequestPayload | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((current) => current + 1), []);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    setState("loading");
    fetchRepositoryPullRequest(owner, name, number)
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
