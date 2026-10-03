import { AppHeader } from "../components/AppHeader";
import type { Account } from "../lib/session-api";

/**
 * Account Settings overview. It exposes the “Password and authentication”
 * entry that opens the security page holding the password-change form.
 */
export function SettingsPage({ account }: { account: Account }) {
  return (
    <div className="app-shell">
      <AppHeader username={account.username} />
      <main>
        <h1>Settings</h1>
        <p className="settings-hint">Manage the credentials of the signed-in account.</p>
        <nav className="settings-nav" aria-label="Settings">
          <a href="#/settings/password">Password and authentication</a>
        </nav>
      </main>
    </div>
  );
}
