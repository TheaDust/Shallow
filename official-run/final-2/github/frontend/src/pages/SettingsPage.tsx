import { AppHeader } from "../components/AppHeader";
import { passwordSettingsHash, sessionsSettingsHash } from "../lib/routes";

/** Account Settings entry point; the security pages live one level below. */
export function SettingsPage() {
  return (
    <main className="page">
      <AppHeader />
      <section className="page__body settings">
        <h1 className="settings__title">Settings</h1>
        <h2 className="settings__section-title">Security</h2>
        <nav className="settings__nav" aria-label="Security">
          <a href={sessionsSettingsHash}>Active sessions</a>
          <a href={passwordSettingsHash}>Password and authentication</a>
        </nav>
      </section>
    </main>
  );
}
