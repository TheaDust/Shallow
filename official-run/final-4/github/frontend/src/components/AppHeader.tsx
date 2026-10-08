import { AccountMenu } from "./AccountMenu";
import { GlobalSearch } from "./GlobalSearch";
import { useSession } from "../lib/session";

export function AppHeader() {
  const { user } = useSession();
  return (
    <header className="app-header">
      <a className="app-header__brand" href="#/" aria-label="Home">
        GitHub
      </a>
      <GlobalSearch />
      {user ? (
        <div className="app-header__session">
          <span className="app-header__account" title={user.username}>
            {user.username}
          </span>
          <AccountMenu />
        </div>
      ) : null}
    </header>
  );
}
