import { useSession } from "../lib/session";

/**
 * Account settings landing page (REQ-1-3): the entry a signed-in user reaches
 * from "Settings" in the account menu, linking to the security page.
 */
export function SettingsPage() {
  const { user } = useSession();
  return (
    <main className="settings-page">
      <h1>Settings</h1>
      {user ? (
        <p className="settings-page__account">
          Signed in as <strong>{user.username}</strong>
        </p>
      ) : null}
      <nav className="settings-page__nav" aria-label="Settings">
        <a href="#/settings/password">Password and authentication</a>
      </nav>
    </main>
  );
}
