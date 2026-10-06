import { AppHeader } from "../components/AppHeader";

/** Account Settings entry point; the security page lives one level below. */
export function SettingsPage() {
  return (
    <main className="page">
      <AppHeader />
      <section className="page__body settings">
        <h1 className="settings__title">Settings</h1>
        <nav className="settings__nav" aria-label="Settings">
          <a href="#/settings/password">Password and authentication</a>
        </nav>
      </section>
    </main>
  );
}
