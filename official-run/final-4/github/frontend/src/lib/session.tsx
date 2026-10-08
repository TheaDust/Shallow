import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { fetchSession, type SessionUser } from "./auth-api";

export interface SessionContextValue {
  status: "loading" | "ready";
  user: SessionUser | null;
  /**
   * True when this browser still holds a session the server no longer accepts
   * (it was revoked from another browser). The routed view answers it with the
   * sign-in page instead of the signed-out entry (REQ-1-4).
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
    const next = await fetchSession().catch(() => ({ user: null, revoked: false }));
    setUserState(next.user);
    setRevoked(next.revoked);
  }, []);

  /**
   * Records an explicit authentication change (a successful sign-in or an
   * intentional sign-out). Both end the revoked state: signing out clears the
   * cookie, and signing in creates a fresh active session.
   */
  const setUser = useCallback((next: SessionUser | null) => {
    setUserState(next);
    setRevoked(false);
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
