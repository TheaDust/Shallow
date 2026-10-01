import { useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import {
  fetchRepositoryContents,
  type RepositoryDirectoryContent,
  type RepositoryFileContent,
} from "./repository-api";

export type RepositoryContentState = "loading" | "ready" | "denied" | "missing" | "failed";

export interface RepositoryContentLoad {
  state: RepositoryContentState;
  file: RepositoryFileContent | null;
  directory: RepositoryDirectoryContent | null;
  /** The number of commits of the branch the content was read from. */
  commitCount: number;
}

/**
 * Loads the file or the directory at a path on a branch (REQ-4-1). The branch
 * is part of the request, so switching branches only changes the snapshot the
 * page reads; a path that does not exist on the branch is reported as missing
 * instead of showing another branch's content.
 */
export function useRepositoryContents(
  owner: string,
  name: string,
  path: string,
  branch: string | undefined,
  enabled: boolean,
): RepositoryContentLoad {
  const [state, setState] = useState<RepositoryContentState>("loading");
  const [file, setFile] = useState<RepositoryFileContent | null>(null);
  const [directory, setDirectory] = useState<RepositoryDirectoryContent | null>(null);
  const [commitCount, setCommitCount] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    setState("loading");
    setFile(null);
    setDirectory(null);
    setCommitCount(0);
    fetchRepositoryContents(owner, name, path, branch)
      .then((result) => {
        if (!active) return;
        setCommitCount(result.commitCount);
        if (result.file) {
          setFile(result.file);
          setState("ready");
          return;
        }
        setDirectory(result.directory);
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
  }, [owner, name, path, branch, enabled]);

  return { state, file, directory, commitCount };
}
