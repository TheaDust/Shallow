import { SESSION_COOKIE, findSessionAccount } from "../domain/identity.mjs";
import { parseCookies } from "./http.mjs";

/** Reads the session cookie of a request without touching any stored state. */
export function readSessionId(request) {
  return parseCookies(request.headers.cookie)[SESSION_COOKIE] ?? "";
}

/**
 * Resolves the signed-in account from the authoritative state. Every protected
 * handler re-reads the session this way, so sign-out and credential changes are
 * visible to subsequent requests immediately.
 */
export async function resolveSessionAccount(store, request) {
  const state = await store.read();
  return { state, account: findSessionAccount(state, readSessionId(request)) };
}
