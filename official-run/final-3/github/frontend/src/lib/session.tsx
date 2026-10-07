import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { fetchSessionState, type SessionUser } from "./auth-api";
import { replace } from "./hash-route";

export interface SessionContextValue {
  status: "loading" | "ready";
  user: SessionUser | null;
  /** The presented cookie names a session another browser revoked. */
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
    const next = await fetchSessionState().catch(() => null);
    if (!next) return;
    setRevoked(next.revoked);
    setUserState(next.user);
    // A browser whose session was revoked elsewhere is sent back to the
    // sign-in page instead of the signed-out home page. The cookie stays, so
    // every later protected visit of this browser keeps landing there.
    if (next.revoked) replace("/sign-in");
  }, []);

  const setUser = useCallback((next: SessionUser | null) => {
    if (next) setRevoked(false);
    setUserState(next);
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
