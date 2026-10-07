import { activeSessionsHash } from "../lib/routes";

/** Account Settings entry point; the security page lives one level below. */
export function SettingsPage() {
  return (
    <main className="page">
      <section className="page__body settings">
        <h1 className="settings__title">Settings</h1>
        <nav className="settings__nav" aria-label="Settings">
          <a href="#/settings/password">Password and authentication</a>
        </nav>
        <section className="settings__section" aria-labelledby="settings-security-title">
          <h2 id="settings-security-title" className="settings__section-title">
            Security
          </h2>
          <nav className="settings__nav" aria-label="Security">
            <a href={activeSessionsHash}>Active sessions</a>
          </nav>
        </section>
      </section>
    </main>
  );
}
