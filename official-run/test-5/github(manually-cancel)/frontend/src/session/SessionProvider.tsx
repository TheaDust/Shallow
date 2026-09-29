import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { loadSession, signOut as signOutRequest, type SessionAccount } from "./session-api";

export interface SessionContextValue {
  /** `loading` until the initial session lookup settles, then `ready`. */
  status: "loading" | "ready";
  account: SessionAccount | null;
  /** Applies the account returned by a successful sign-in without a round trip. */
  setAccount(account: SessionAccount | null): void;
  reload(): Promise<void>;
  /** Ends the current browser session on the server and clears local state. */
  endSession(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ status: "loading" | "ready"; account: SessionAccount | null }>({
    status: "loading",
    account: null,
  });

  const reload = useCallback(async () => {
    try {
      const payload = await loadSession();
      setState({ status: "ready", account: payload.account });
    } catch {
      setState({ status: "ready", account: null });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<SessionContextValue>(
    () => ({
      status: state.status,
      account: state.account,
      setAccount: (account) => setState({ status: "ready", account }),
      reload,
      endSession: async () => {
        try {
          await signOutRequest();
        } finally {
          setState({ status: "ready", account: null });
        }
      },
    }),
    [state.status, state.account, reload],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside a SessionProvider");
  return value;
}
