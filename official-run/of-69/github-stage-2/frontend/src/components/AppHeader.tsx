import { navigate } from "../lib/hash-route";
import { useSession } from "../session/session-context";
import { AccountMenu } from "./AccountMenu";
import { GlobalSearch } from "./GlobalSearch";

export interface AppHeaderProps {
  /** The signed-in account, or null for a visitor (no account menu then). */
  username?: string | null;
}

/**
 * Top bar of every page. It carries the home entry, the global “Search”
 * searchbox and — for a signed-in account — the account menu that owns the
 * Settings entry and the sign-out confirmation.
 */
export function AppHeader({ username }: AppHeaderProps) {
  const { signOut } = useSession();

  return (
    <header className="app-header">
      <a className="app-header__home" href="#/" aria-label="Home">
        GitHub
      </a>
      <GlobalSearch />
      {username ? (
        <AccountMenu
          username={username}
          onSignOut={async () => {
            await signOut();
            navigate("/");
          }}
        />
      ) : null}
    </header>
  );
}
