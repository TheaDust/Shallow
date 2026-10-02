import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  fetchCurrentAccount,
  signInRequest,
  signOutRequest,
  type Account,
} from "../../lib/session-api";

export interface AccountSessionValue {
  /** "loading" until the first /api/session read settles. */
  status: "loading" | "ready";
  account: Account | null;
  signIn(identifier: string, password: string): Promise<Account>;
  signOut(): Promise<void>;
  refresh(): Promise<Account | null>;
}

const AccountSessionContext = createContext<AccountSessionValue | null>(null);

export function AccountSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [account, setAccount] = useState<Account | null>(null);

  const refresh = useCallback(async () => {
    try {
      const current = await fetchCurrentAccount();
      setAccount(current);
      return current;
    } catch {
      setAccount(null);
      return null;
    } finally {
      setStatus("ready");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AccountSessionValue>(
    () => ({
      status,
      account,
      async signIn(identifier, password) {
        const signedIn = await signInRequest(identifier, password);
        setAccount(signedIn);
        setStatus("ready");
        return signedIn;
      },
      async signOut() {
        await signOutRequest();
        setAccount(null);
      },
      refresh,
    }),
    [account, refresh, status],
  );

  return (
    <AccountSessionContext.Provider value={value}>{children}</AccountSessionContext.Provider>
  );
}

export function useAccountSession(): AccountSessionValue {
  const value = useContext(AccountSessionContext);
  if (!value) throw new Error("useAccountSession must be used inside AccountSessionProvider");
  return value;
}
