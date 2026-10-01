import type { ReactNode } from "react";

import { AccountMenu } from "../components/AccountMenu";
import { useSession } from "../lib/session";

export interface AuthPageProps {
  title: string;
  children: ReactNode;
}

/**
 * Shared shell for the account-access pages (register, sign in, recover).
 *
 * The account menu lives in the upper-right corner of every page (REQ-1), so a
 * visitor who is already signed in keeps seeing the current account — and the
 * way to security settings or sign-out — while on the account-access page.
 */
export function AuthPage({ title, children }: AuthPageProps) {
  const { user } = useSession();
  return (
    <main className="auth-page">
      <div className="auth-page__topbar">
        <a className="auth-page__brand" href="#/">
          GitHub
        </a>
        {user ? (
          <a className="app-header__user" href="#/workspace">
            {user.username}
          </a>
        ) : null}
        {user ? <AccountMenu user={user} /> : null}
      </div>
      <div className="auth-page__card">
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}
