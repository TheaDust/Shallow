import { useSession } from "../session/SessionProvider";
import { AuthenticationRequired, BusyMain } from "./common";

/** REQ-1: the account settings area reachable from the account menu. */
export function SettingsPage() {
  const { status, account } = useSession();

  if (status === "loading") return <BusyMain />;
  if (!account) return <AuthenticationRequired />;

  return (
    <main>
      <h1>Settings</h1>
      <p>Manage the settings of the account you are signed in with.</p>
      <nav aria-label="Settings sections">
        <ul className="settings-nav">
          <li>
            <a href="#/settings/password">Password and authentication</a>
          </li>
        </ul>
      </nav>
    </main>
  );
}
