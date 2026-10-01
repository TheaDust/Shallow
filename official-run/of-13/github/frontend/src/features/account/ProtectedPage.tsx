import type { ReactNode } from "react";

import { useAccountSession } from "./AccountSession";

export interface ProtectedPageProps {
  title: string;
  children: ReactNode;
}

/**
 * Shared shell for pages that require a session. While the session is being
 * read it keeps the page structure stable; without a session it restores the
 * unauthenticated state with the "Sign in" entry instead of the content.
 */
export function ProtectedPage({ title, children }: ProtectedPageProps) {
  const { status, account } = useAccountSession();

  if (status === "loading") {
    return (
    <>
      <h1>{title}</h1>
      <p role="status">Loading…</p>
    </>
    );
  }

  if (!account) {
    return (
      <>
        <h1>{title}</h1>
        <p role="status">You need to sign in to view this page.</p>
        <p>
          <a href="#/login">Sign in</a>
        </p>
      </>
    );
  }

  return (
    <>
      <h1>{title}</h1>
      {children}
    </>
  );
}
