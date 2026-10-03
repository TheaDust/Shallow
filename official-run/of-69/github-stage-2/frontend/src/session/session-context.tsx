import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { fetchSession, signOut as signOutRequest, type Account } from "../lib/session-api";

export interface SessionValue {
  account: Account | null;
  status: "loading" | "ready";
  setAccount(account: Account | null): void;
  refresh(): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Loads the current-browser session once on startup. Every page reads the same
 * authoritative value so refresh and navigation stay consistent.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [status, setStatus] = useState<"loading" | "ready">("loading");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const current = await fetchSession();
        if (active) setAccount(current);
      } catch {
        if (active) setAccount(null);
      } finally {
        if (active) setStatus("ready");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      setAccount(await fetchSession());
    } catch {
      setAccount(null);
    }
  }, []);

  const signOut = useCallback(async () => {
    await signOutRequest();
    setAccount(null);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ account, status, setAccount, refresh, signOut }),
    [account, status, refresh, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
