import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { fetchSession, type AccountInfo } from "./api";

export type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; account: AccountInfo };

interface SessionContextValue {
  session: SessionState;
  refreshSession(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>({ status: "loading" });

  const refreshSession = useCallback(async () => {
    const response = await fetchSession();
    setSession(
      response.authenticated && response.account
        ? { status: "authenticated", account: response.account }
        : { status: "anonymous" },
    );
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  return <SessionContext.Provider value={{ session, refreshSession }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used within SessionProvider");
  return value;
}
