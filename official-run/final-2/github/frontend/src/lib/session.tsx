import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { UNAUTHORIZED_EVENT } from "./api";
import { fetchSessionState, type SessionUser } from "./auth-api";

export interface SessionContextValue {
  status: "loading" | "ready";
  user: SessionUser | null;
  /**
   * True when this browser still sends a session cookie that the server no
   * longer accepts as active. The app then returns to the sign-in page instead
   * of keeping the previous signed-in view.
   */
  revoked: boolean;
  setUser(user: SessionUser | null): void;
  refresh(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<SessionUser | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready">("loading");

  const refresh = useCallback(async () => {
    const next = await fetchSessionState().catch(() => ({ user: null, revoked: false }));
    setUserState(next.user);
    setRevoked(next.user ? false : next.revoked);
  }, []);

  const setUser = useCallback((next: SessionUser | null) => {
    setUserState(next);
    if (next) setRevoked(false);
  }, []);

  useEffect(() => {
    let active = true;
    refresh().finally(() => {
      if (active) setStatus("ready");
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  // A protected call answered 401: the session of this browser is gone, so the
  // identity is re-read before any further signed-in view is shown.
  useEffect(() => {
    const onUnauthorized = () => {
      void refresh();
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [refresh]);

  const value = useMemo<SessionContextValue>(
    () => ({ status, user, revoked, setUser, refresh }),
    [status, user, revoked, setUser, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used within a SessionProvider");
  return context;
}
