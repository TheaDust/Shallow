import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { apiRequest, postJsonSync } from "./api";

export interface SessionOrganization {
  name: string;
  displayName: string;
  role: "Owner" | "Member" | null;
}

export interface SessionUser {
  username: string;
  email: string;
  organizations: SessionOrganization[];
}

export type SignInOutcome = { ok: true } | { ok: false; message: string };

export interface SessionContextValue {
  user: SessionUser | null;
  loading: boolean;
  /** Commits the session before returning so an immediate reload sees it (REQ-1-1-2). */
  signIn(identifier: string, password: string): SignInOutcome;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function normalizeUser(payload: { user?: SessionUser | null }): SessionUser | null {
  const user = payload?.user ?? null;
  if (!user) return null;
  return {
    username: user.username,
    email: user.email,
    organizations: Array.isArray(user.organizations)
      ? user.organizations.map((organization) => ({
          name: organization.name,
          displayName: organization.displayName ?? organization.name,
          role: organization.role ?? null,
        }))
      : [],
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const payload = await apiRequest<{ user: SessionUser | null }>("/api/session");
      setUser(normalizeUser(payload));
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback((identifier: string, password: string): SignInOutcome => {
    let response: { status: number; body: { user?: SessionUser | null; error?: string } | null };
    try {
      response = postJsonSync<{ user?: SessionUser | null; error?: string }>("/api/sessions", {
        identifier,
        password,
      });
    } catch {
      return { ok: false, message: "Unable to sign in right now. Please try again." };
    }
    if (response.status >= 200 && response.status < 300 && response.body?.user) {
      setUser(normalizeUser(response.body));
      return { ok: true };
    }
    return {
      ok: false,
      message: response.body?.error ?? "Unable to sign in right now. Please try again.",
    };
  }, []);

  const signOut = useCallback(async () => {
    try {
      await apiRequest("/api/session", { method: "DELETE" });
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ user, loading, signIn, signOut, refresh }),
    [user, loading, signIn, signOut, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
