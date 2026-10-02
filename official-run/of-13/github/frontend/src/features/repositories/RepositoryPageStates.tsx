import type { ReactNode } from "react";

export function RepositoryAccessDenied({ signedIn }: { signedIn: boolean }) {
  return (
    <>
      <h1>Access denied</h1>
      <p>You are not allowed to view this repository.</p>
      {!signedIn ? (
        <p>
          <a href="#/login">Sign in</a>
        </p>
      ) : null}
    </>
  );
}

export function RepositoryNotFound() {
  return (
    <>
      <h1>Page not found</h1>
      <p>
        <a href="#/">Go to the home page</a>
      </p>
    </>
  );
}

export function RepositoryLoading({ children }: { children?: ReactNode }) {
  return (
    <>
      {children}
      <p role="status">Loading…</p>
    </>
  );
}
