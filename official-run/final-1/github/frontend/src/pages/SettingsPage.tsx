import { AppHeader } from "../components/AppHeader";
import { activeSessionsHash, passwordSettingsHash } from "../lib/routes";

/** Account Settings entry point; the security pages live one level below. */
export function SettingsPage() {
  return (
    <main className="page">
      <AppHeader />
      <section className="page__body settings">
        <h1 className="settings__title">Settings</h1>
        <nav className="settings__nav" aria-label="Settings">
          <a href={passwordSettingsHash}>Password and authentication</a>
          <a href={activeSessionsHash}>Active sessions</a>
        </nav>
      </section>
    </main>
  );
}
