import { navigate } from "../lib/hash-route";
import { useSession } from "../session/session-context";
import { AccountMenu } from "./AccountMenu";

/**
 * Upper-right header shown on every page a signed-in account can reach. The
 * account menu owns the Settings entry and the sign-out confirmation.
 */
export function AppHeader({ username }: { username: string }) {
  const { signOut } = useSession();

  return (
    <header className="app-header">
      <AccountMenu
        username={username}
        onSignOut={async () => {
          await signOut();
          navigate("/");
        }}
      />
    </header>
  );
}
