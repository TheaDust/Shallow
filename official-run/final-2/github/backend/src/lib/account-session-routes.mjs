import { MESSAGES } from "./auth-rules.mjs";
import { sendJson } from "./http.mjs";

// The security area's browser-session surface. Both routes resolve the caller
// from the session cookie only: the account identity and the "current session"
// flag are decided by the server, never by the request body.

const SESSIONS_PATH = "/api/account/sessions";
const REVOKE_PATTERN = /^\/api\/account\/sessions\/([^/]+)\/revoke$/;

export function createAccountSessionApi({ store, currentAuth }) {
  async function resolveCurrent(request) {
    const { sessionId, user } = await currentAuth(request);
    if (!user) return null;
    return { sessionId, user };
  }

  return async function handleAccountSessionApi(request, response, url, method) {
    if (url.pathname !== SESSIONS_PATH && !REVOKE_PATTERN.test(url.pathname)) return false;

    const caller = await resolveCurrent(request);
    if (!caller) {
      sendJson(response, 401, { message: "Not signed in" });
      return true;
    }

    if (method === "GET" && url.pathname === SESSIONS_PATH) {
      const sessions = await store.listSessions(caller.user.id, caller.sessionId);
      sendJson(response, 200, { sessions });
      return true;
    }

    const revoke = method === "POST" ? REVOKE_PATTERN.exec(url.pathname) : null;
    if (revoke) {
      const handle = decodeURIComponent(revoke[1]);
      const sessions = await store.listSessions(caller.user.id, caller.sessionId);
      const target = sessions.find((session) => session.handle === handle);
      if (!target) {
        sendJson(response, 404, { message: MESSAGES.sessionNotFound });
        return true;
      }
      if (target.current) {
        sendJson(response, 400, { message: MESSAGES.currentSessionLocked });
        return true;
      }
      await store.revokeSession(caller.user.id, handle);
      sendJson(response, 200, {
        message: MESSAGES.sessionRevoked,
        sessions: await store.listSessions(caller.user.id, caller.sessionId),
      });
      return true;
    }

    sendJson(response, 404, { error: "Not found" });
    return true;
  };
}
