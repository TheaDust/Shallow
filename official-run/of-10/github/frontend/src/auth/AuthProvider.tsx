import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { fetchCurrentAccount, type AccountSummary } from "../lib/accounts-api";

export type AuthStatus = "loading" | "ready";

export interface AuthContextValue {
  status: AuthStatus;
  account: AccountSummary | null;
  setAccount(account: AccountSummary | null): void;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** The signed-in account is server-owned; the client only mirrors the session. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [account, setAccount] = useState<AccountSummary | null>(null);

  const refresh = useCallback(async () => {
    try {
      setAccount(await fetchCurrentAccount());
    } catch {
      setAccount(null);
    } finally {
      setStatus("ready");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, account, setAccount, refresh }),
    [status, account, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
