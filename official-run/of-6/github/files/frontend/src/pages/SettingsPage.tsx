import { useSession } from '../session';
import { useRedirectTo } from '../router';

/**
 * Account Settings (REQ-1-3 entry point). The signed-in user opens Settings
 * from the account menu; the page exposes the "Password and authentication"
 * security section. Unauthenticated visitors are redirected to sign-in.
 */
export default function SettingsPage() {
  const { auth } = useSession();
  const needsAuth = auth.status !== 'ready' || !auth.user;
  useRedirectTo('#/signin', needsAuth);
  if (needsAuth) {
    return null;
  }
  return (
    <div className="settings-page">
      <h1>Settings</h1>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings">
          <a className="settings-nav-link" href="#/settings/password">
            Password and authentication
          </a>
        </nav>
        <div className="settings-content">
          <p className="settings-intro">
            Manage your account settings.
          </p>
        </div>
      </div>
    </div>
  );
}
