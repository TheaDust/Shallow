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
  /** True when this browser held a session that has since been revoked. */
  revoked: boolean;
  setUser(user: SessionUser | null): void;
  refresh(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready">("loading");

  const refresh = useCallback(async () => {
    const next = await fetchSession().catch(() => ({ user: null, revoked: false }));
    setUser(next.user);
    setRevoked(next.revoked);
  }, []);

  // Signing in or out is an explicit session change, so the server answer of
  // the next read (not a stale revocation) decides the state afterwards.
  const updateUser = useCallback((next: SessionUser | null) => {
    setUser(next);
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
    () => ({ status, user, revoked, setUser: updateUser, refresh }),
    [status, user, revoked, updateUser, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used within a SessionProvider");
  return context;
}
