import { useSession } from "../session/SessionProvider";
import { AccountMenu } from "./AccountMenu";

export interface AppHeaderProps {
  /**
   * Protected pages render their own "Sign in" link when the visitor is
   * unauthenticated, so the shared guest navigation stays out of the way.
   */
  showGuestNavigation: boolean;
}

export function AppHeader({ showGuestNavigation }: AppHeaderProps) {
  const { status, account } = useSession();

  return (
    <header className="app-header">
      <div className="app-header__inner">
        {account ? (
          <AccountMenu />
        ) : status === "ready" && showGuestNavigation ? (
          <nav className="app-header__nav" aria-label="Account access">
            <a href="#/signup">Sign up</a>
            <a href="#/login">Sign in</a>
            <a href="#/forgot-password">Forgot password</a>
          </nav>
        ) : null}
      </div>
    </header>
  );
}
