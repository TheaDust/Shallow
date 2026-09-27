import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getSession, signOut as apiSignOut } from './api';
import type { SessionUser } from './types';
import { navigate, useHashRoute } from './router';
import AccountMenu from './components/AccountMenu';
import HomePage from './pages/HomePage';
import SignInPage from './pages/SignInPage';
import SignUpPage from './pages/SignUpPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import SettingsPage from './pages/SettingsPage';
import PasswordAndAuthenticationPage from './pages/PasswordAndAuthenticationPage';
import NotFoundPage from './pages/NotFoundPage';

interface SessionContextValue {
  user: SessionUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export { SessionContext };

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionContext');
  return ctx;
}

// Registration and sign-in are visitor-only; the recovery page stays reachable
// from any session state so the REQ-1-1-3 flow can also be exercised after
// signing in.
const ACCOUNT_ACCESS_PATHS = new Set(['/signin', '/signup']);

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const route = useHashRoute();

  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    const res = await getSession();
    setUser(res.user);
  }, []);

  const signOut = useCallback(async () => {
    await apiSignOut();
    setUser(null);
    navigate('#/');
  }, []);

  // Signed-in users do not see the account-access page.
  useEffect(() => {
    if (user && ACCOUNT_ACCESS_PATHS.has(route.path)) {
      navigate('#/');
    }
  }, [user, route.path]);

  let page: ReactNode;
  if (loading) {
    page = <p role="status">Loading…</p>;
  } else if (user && ACCOUNT_ACCESS_PATHS.has(route.path)) {
    page = <HomePage />;
  } else {
    switch (route.path) {
      case '/':
        page = <HomePage />;
        break;
      case '/signin':
        page = <SignInPage />;
        break;
      case '/signup':
        page = <SignUpPage />;
        break;
      case '/forgot-password':
        page = <ForgotPasswordPage />;
        break;
      case '/settings':
        page = <SettingsPage />;
        break;
      case '/settings/password-and-authentication':
        page = <PasswordAndAuthenticationPage />;
        break;
      default:
        page = <NotFoundPage />;
    }
  }

  return (
    <SessionContext.Provider value={{ user, loading, refresh, signOut }}>
      <div className="app">
        {user && (
          <header className="topbar">
            <div className="topbar-right">
              <AccountMenu user={user} />
            </div>
          </header>
        )}
        <main>{page}</main>
      </div>
    </SessionContext.Provider>
  );
}
