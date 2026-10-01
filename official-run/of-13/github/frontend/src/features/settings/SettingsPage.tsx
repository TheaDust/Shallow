import { ProtectedPage } from "../account/ProtectedPage";

/**
 * Account settings entry point. Later modules hang profile, organization and
 * repository settings off this page.
 */
export function SettingsPage() {
  return (
    <ProtectedPage title="Settings">
      <nav>
        <ul className="settings-nav">
          <li>
            <a href="#/settings/password">Password and authentication</a>
          </li>
        </ul>
      </nav>
    </ProtectedPage>
  );
}
