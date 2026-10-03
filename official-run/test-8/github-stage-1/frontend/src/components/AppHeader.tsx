import type { Account } from "../api/auth";
import { makeHash } from "../lib/hash-route";
import { AccountMenu } from "./AccountMenu";

export interface AppHeaderProps {
  account: Account;
}

export function AppHeader({ account }: AppHeaderProps) {
  return (
    <header className="app-header">
      <a className="app-header__brand" href={makeHash("/")}>
        GitHub
      </a>
      <AccountMenu account={account} />
    </header>
  );
}
