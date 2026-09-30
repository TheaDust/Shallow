import type { ReactNode } from "react";

export interface NotFoundPageProps {
  /**
   * Optional explanation for a repository address the current viewer may not
   * read: a visitor needs a session or an explicit permission to open it.
   */
  hint?: ReactNode;
}

/**
 * Shared "not found" view. It is also the answer for a repository the current
 * viewer may not read, so it never repeats the requested repository name.
 */
export function NotFoundPage({ hint }: NotFoundPageProps = {}) {
  return (
    <main>
      <h1>Page not found</h1>
      <p>The page you requested does not exist.</p>
      {hint}
    </main>
  );
}

/** Hint for a repository address that may require a session or a permission. */
export function repositoryAccessHint() {
  return (
    <p>
      Sign in with an account that may read this repository, or ask its owner for access:{" "}
      <a href="#/signin">Sign in</a>
    </p>
  );
}
