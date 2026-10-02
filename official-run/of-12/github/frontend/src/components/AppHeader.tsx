import { AccountMenu } from "./AccountMenu";
import { SearchBox } from "./SearchBox";
import { useSession } from "../lib/session";

/**
 * Global header: the brand entry, the global repository search (REQ-3-1) and
 * the signed-in account (REQ-1). The account appears as its own profile link
 * next to the "Account menu" button, so the current session is visible on every
 * page (REQ-1-1-2, REQ-2-1-2).
 */
export function AppHeader() {
  const { user } = useSession();
  return (
    <header className="app-header">
      <a className="app-header__brand" href="#/">
        GitHub
      </a>
      <SearchBox />
      <div className="app-header__account">
        {user ? (
          <a className="app-header__user" href="#/workspace">
            {user.username}
          </a>
        ) : null}
        {user ? <AccountMenu user={user} /> : null}
      </div>
    </header>
  );
}
