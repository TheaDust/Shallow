import { createContext, useContext } from 'react';
import type { AuthState, SessionUser } from './types';

export interface SessionContextValue {
  auth: AuthState;
  refresh: () => Promise<void>;
  updateUser: (user: SessionUser | null) => void;
}

export const SessionContext = createContext<SessionContextValue>({
  auth: { status: 'ready', user: null },
  refresh: async () => {},
  updateUser: () => {},
});

export function useSession(): SessionContextValue {
  return useContext(SessionContext);
}
