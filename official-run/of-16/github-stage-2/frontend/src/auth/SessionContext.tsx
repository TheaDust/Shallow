import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { fetchSession, signIn as signInRequest, signOut as signOutRequest } from "./api";
import type { Account } from "./types";

export interface SessionValue {
  /** "loading" until the initial session lookup settles. */
  status: "loading" | "ready";
  account: Account | null;
  refresh(): Promise<void>;
  signIn(identifier: string, password: string): Promise<Account>;
  signOut(): Promise<void>;
  setAccount(account: Account | null): void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionValue["status"]>("loading");
  const [account, setAccount] = useState<Account | null>(null);

  const refresh = useCallback(async () => {
    try {
      setAccount(await fetchSession());
    } catch {
      setAccount(null);
    } finally {
      setStatus("ready");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<SessionValue>(() => ({
    status,
    account,
    refresh,
    setAccount,
    async signIn(identifier, password) {
      const next = await signInRequest(identifier, password);
      setAccount(next);
      setStatus("ready");
      return next;
    },
    async signOut() {
      await signOutRequest();
      setAccount(null);
      setStatus("ready");
    },
  }), [account, refresh, status]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside a SessionProvider");
  return value;
}
