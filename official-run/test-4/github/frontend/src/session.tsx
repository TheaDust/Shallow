import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { Account, fetchCurrentSession, signIn as apiSignIn, signOut as apiSignOut } from "./lib/account-api";

export type SessionStatus = "loading" | "anonymous" | "authenticated";

export interface SessionState {
  status: SessionStatus;
  account: Account | null;
  refresh: () => Promise<void>;
  signIn: (identifier: string, password: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [account, setAccount] = useState<Account | null>(null);

  const refresh = useCallback(async () => {
    setStatus("loading");
    try {
      const current = await fetchCurrentSession();
      setAccount(current);
      setStatus(current ? "authenticated" : "anonymous");
    } catch {
      setAccount(null);
      setStatus("anonymous");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async (identifier: string, password: string) => {
    const result = await apiSignIn({ identifier, password });
    if (!result.ok) return result;
    setAccount(result.account);
    setStatus("authenticated");
    return { ok: true as const };
  }, []);

  const signOut = useCallback(async () => {
    await apiSignOut();
    setAccount(null);
    setStatus("anonymous");
  }, []);

  return (
    <SessionContext.Provider value={{ status, account, refresh, signIn, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
}
