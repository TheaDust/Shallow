import { randomUUID } from "node:crypto";

export const SESSION_COOKIE = "shallow_session";

export function readCookie(request, name) {
  const header = request.headers?.cookie ?? "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return undefined;
}

export function publicAccount(account) {
  if (!account) return null;
  return {
    id: account.id,
    username: account.username,
    email: account.email,
    emailVerified: Boolean(account.emailVerified),
    status: account.status,
  };
}

export function sessionCookie(sessionId) {
  return `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function createSession(database, accountId) {
  const session = {
    id: randomUUID(),
    accountId,
    status: "active",
    createdAt: new Date().toISOString(),
  };
  await database.sessions.update((state) => {
    state.sessions.push(session);
    return state;
  });
  return session;
}

export async function findActiveSession(database, request) {
  const sessionId = readCookie(request, SESSION_COOKIE);
  if (!sessionId) return null;
  const { sessions } = await database.sessions.read();
  return sessions.find((session) => session.id === sessionId && session.status === "active") ?? null;
}

export async function findCurrentAccount(database, request) {
  const session = await findActiveSession(database, request);
  if (!session) return null;
  const { accounts } = await database.accounts.read();
  const account = accounts.find((candidate) => candidate.id === session.accountId);
  if (!account || account.status !== "available") return null;
  return account;
}

export async function invalidateCurrentSession(database, request) {
  const sessionId = readCookie(request, SESSION_COOKIE);
  if (!sessionId) return;
  await database.sessions.update((state) => {
    const session = state.sessions.find((candidate) => candidate.id === sessionId);
    if (session) session.status = "inactive";
    return state;
  });
}
