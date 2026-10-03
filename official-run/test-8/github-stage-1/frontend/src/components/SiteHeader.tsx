import type { Account } from "../api/auth";
import { makeHash } from "../lib/hash-route";
import { AccountMenu } from "./AccountMenu";

export interface SiteHeaderProps {
  account: Account | null;
}

/**
 * Header for public-or-private pages: signed-in accounts get the account menu,
 * visitors get the plain “Sign in” entry so the page still exposes a way in.
 */
export function SiteHeader({ account }: SiteHeaderProps) {
  return (
    <header className="app-header">
      <a className="app-header__brand" href={makeHash("/")}>
        GitHub
      </a>
      {account ? (
        <AccountMenu account={account} />
      ) : (
        <a className="app-header__auth-link" href={makeHash("/signin")}>
          Sign in
        </a>
      )}
    </header>
  );
}
