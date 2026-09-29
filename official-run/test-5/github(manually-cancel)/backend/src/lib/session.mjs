import { randomUUID } from "node:crypto";

export const SESSION_COOKIE = "shallow_session";

export function parseCookies(header) {
  const cookies = new Map();
  if (typeof header !== "string") return cookies;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies.set(name, decodeURIComponent(value));
  }
  return cookies;
}

export function readSessionId(request) {
  return parseCookies(request.headers.cookie).get(SESSION_COOKIE) ?? null;
}

export function attachSessionCookie(response, sessionId) {
  response.setHeader(
    "set-cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax`,
  );
}

export function clearSessionCookie(response) {
  response.setHeader(
    "set-cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}

export function newSessionId() {
  return randomUUID();
}

export async function findActiveSession(sessionsStore, sessionId) {
  if (!sessionId) return null;
  const { sessions } = await sessionsStore.read();
  return sessions.find((session) => session.id === sessionId && session.active === true) ?? null;
}

export async function createSession(sessionsStore, accountId) {
  const session = {
    id: newSessionId(),
    accountId,
    active: true,
    createdAt: new Date().toISOString(),
  };
  await sessionsStore.update((state) => {
    state.sessions.push(session);
  });
  return session;
}

export async function invalidateSession(sessionsStore, sessionId) {
  if (!sessionId) return false;
  let invalidated = false;
  await sessionsStore.update((state) => {
    const session = state.sessions.find((candidate) => candidate.id === sessionId);
    if (session && session.active) {
      session.active = false;
      session.endedAt = new Date().toISOString();
      invalidated = true;
    }
  });
  return invalidated;
}
