import { useEffect } from 'react';
import { useSession } from '../App';
import { navigate } from '../router';

// REQ-1-3: Settings page. Only signed-in users may open it; signed-out
// visitors are sent back to the home page.
export default function SettingsPage() {
  const { user } = useSession();

  useEffect(() => {
    if (!user) navigate('#/');
  }, [user]);

  if (!user) return null;

  return (
    <>
      <h1>Settings</h1>
      <nav className="settings-nav" aria-label="Settings">
        <a href="#/settings/password-and-authentication">Password and authentication</a>
      </nav>
    </>
  );
}
