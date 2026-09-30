import { useAuth } from "../auth/AuthProvider";
import { navigate } from "../lib/hash-route";
import { signOutAccount } from "../lib/accounts-api";
import { AccountMenu } from "./AccountMenu";
import { GlobalSearch } from "./GlobalSearch";

export interface AppHeaderProps {
  /** Account-access pages render their own forms, so the header omits the guest entries there. */
  showGuestEntries: boolean;
}

export function AppHeader({ showGuestEntries }: AppHeaderProps) {
  const { status, account, setAccount } = useAuth();

  const handleSignOut = () => {
    setAccount(null);
    navigate("/");
    void signOutAccount().catch(() => undefined);
  };

  return (
    <header className="app-header">
      <a className="app-header__home" href="#/">
        Home
      </a>
      <GlobalSearch />
      <div className="app-header__account">
        {status === "loading" ? (
          <span className="app-header__pending" aria-hidden="true">
            …
          </span>
        ) : account ? (
          <AccountMenu account={account} onSignOut={handleSignOut} />
        ) : showGuestEntries ? (
          <nav className="app-nav" aria-label="Account access">
            <a href="#/signup">Sign up</a>
            <a href="#/signin">Sign in</a>
            <a href="#/password-reset">Forgot password</a>
          </nav>
        ) : null}
      </div>
    </header>
  );
}
