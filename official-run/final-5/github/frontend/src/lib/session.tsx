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
  setUser(user: SessionUser | null): void;
  refresh(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<"loading" | "ready">("loading");

  const refresh = useCallback(async () => {
    const next = await fetchSession().catch(() => null);
    setUser(next);
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
    () => ({ status, user, setUser, refresh }),
    [status, user, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used within a SessionProvider");
  return context;
}
