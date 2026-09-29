import { findActiveSession, readSessionId } from "./session.mjs";

/**
 * Resolves the signed-in account for a request from the browser session cookie.
 * Returns `null` when there is no active session or the session points at a
 * missing account. The trusted boundary for every protected operation.
 */
export async function getCurrentAccount(stores, request) {
  const session = await findActiveSession(stores.sessions, readSessionId(request));
  if (!session) return null;
  const { accounts } = await stores.accounts.read();
  const account = accounts.find((candidate) => candidate.id === session.accountId) ?? null;
  if (!account) return null;
  return { account, session };
}
