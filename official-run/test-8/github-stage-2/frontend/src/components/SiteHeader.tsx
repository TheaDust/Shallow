import type { Account } from "../api/auth";
import { makeHash } from "../lib/hash-route";
import { AccountMenu } from "./AccountMenu";
import { GlobalSearch } from "./GlobalSearch";

export interface SiteHeaderProps {
  account: Account | null;
  /**
   * The global repository search. Repository code pages hide it and render the
   * repository’s own Search box instead, so the accessible name “Search” stays
   * unique on the active page (REQ-4 names every control by its accessible name).
   */
  showGlobalSearch?: boolean;
}

/**
 * Header for public-or-private pages: it carries the product link, the global
 * repository search and the signed-in account menu (or the plain “Sign in”
 * entry for visitors, so a public page still exposes a way in).
 */
export function SiteHeader({ account, showGlobalSearch = true }: SiteHeaderProps) {
  return (
    <header className="app-header">
      <a className="app-header__brand" href={makeHash("/")}>
        GitHub
      </a>
      {showGlobalSearch ? <GlobalSearch /> : null}
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
