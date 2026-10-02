import type { ReactNode } from "react";

import type { RepositoryLoadState } from "./use-repository";

/**
 * Shared page frames for a repository page that cannot show content: a private
 * repository the caller may not read, an unknown repository, and the states
 * around loading (REQ-3-3).
 */
export function RepositoryMessage({ children }: { children: ReactNode }) {
  return <main className="repository-page">{children}</main>;
}

export function RepositoryAccessDenied() {
  return (
    <RepositoryMessage>
      <h1>Access denied</h1>
      <p>This repository is private and your account does not have permission to view it.</p>
      <p>
        <a href="#/sign-in">Sign in</a>
      </p>
    </RepositoryMessage>
  );
}

export function RepositoryNotFound() {
  return (
    <RepositoryMessage>
      <h1>Repository not found</h1>
      <p>
        <a href="#/">Back to home</a>
      </p>
    </RepositoryMessage>
  );
}

/** The single busy/error frame a repository page shows while it loads. */
export function RepositoryLoadState({ state }: { state: RepositoryLoadState }) {
  if (state === "denied") return <RepositoryAccessDenied />;
  if (state === "missing") return <RepositoryNotFound />;
  return (
    <RepositoryMessage>
      {state === "failed" ? (
        <p role="alert">The repository could not be loaded. Please try again.</p>
      ) : (
        <p role="status">Loading repository…</p>
      )}
    </RepositoryMessage>
  );
}
