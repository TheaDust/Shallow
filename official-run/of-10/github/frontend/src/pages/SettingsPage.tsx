import { SignInRequired } from "../auth/SignInRequired";
import { useAuth } from "../auth/AuthProvider";

/** Account Settings landing page reached from the account menu. */
export function SettingsPage() {
  const { status, account } = useAuth();
  const loading = status === "loading";

  return (
    <main aria-busy={loading ? true : undefined}>
      <h1>Settings</h1>
      {loading ? (
        <p role="status">Loading your session…</p>
      ) : account ? (
        <nav aria-label="Settings sections">
          <ul className="settings-nav">
            <li>
              <a href="#/settings/password">Password and authentication</a>
            </li>
          </ul>
        </nav>
      ) : (
        <SignInRequired />
      )}
    </main>
  );
}
