/**
 * Account settings. "Password and authentication" is the security page that
 * manages the credentials of the signed-in account.
 */
export function SettingsPage() {
  return (
    <section className="page page--narrow">
      <h1>Settings</h1>
      <nav className="settings-nav" aria-label="Settings">
        <ul className="settings-nav__list">
          <li>
            <a href="#/settings/password">Password and authentication</a>
          </li>
        </ul>
      </nav>
    </section>
  );
}
