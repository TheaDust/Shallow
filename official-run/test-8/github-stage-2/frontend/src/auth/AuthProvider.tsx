import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  fetchSession,
  signInRequest,
  signOutRequest,
  type Account,
} from "../api/auth";

export type AuthStatus = "loading" | "anonymous" | "authenticated";

export interface SignInResult {
  ok: boolean;
  message?: string;
}

export interface AuthContextValue {
  status: AuthStatus;
  account: Account | null;
  signIn(identifier: string, password: string): Promise<SignInResult>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSession()
      .then((result) => {
        if (cancelled) return;
        setAccount(result.account ?? null);
        setStatus(result.account ? "authenticated" : "anonymous");
      })
      .catch(() => {
        if (cancelled) return;
        setAccount(null);
        setStatus("anonymous");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (identifier: string, password: string): Promise<SignInResult> => {
    try {
      const result = await signInRequest(identifier, password);
      setAccount(result.account ?? null);
      setStatus(result.account ? "authenticated" : "anonymous");
      return { ok: true };
    } catch (error) {
      setAccount(null);
      setStatus("anonymous");
      return { ok: false, message: error instanceof Error ? error.message : "Invalid credentials" };
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await signOutRequest();
    } catch {
      // Even if the request fails the local session view must become anonymous.
    }
    setAccount(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, account, signIn, signOut }),
    [status, account, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside an AuthProvider");
  return value;
}
