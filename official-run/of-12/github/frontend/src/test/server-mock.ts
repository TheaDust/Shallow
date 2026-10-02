import { vi } from "vitest";

export interface MockAccount {
  username: string;
  email: string;
  password: string;
}

export interface MockResponse {
  status: number;
  body: unknown;
}

export interface MockRequest {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

export interface MockState {
  accounts: MockAccount[];
  session: MockAccount | null;
  registration: MockResponse;
  passwordChange: MockResponse;
  recoveryRequest: MockResponse;
  recoveryCompletion: MockResponse;
  requests: MockRequest[];
}

export interface MockServer {
  state: MockState;
  install(): void;
}

function makeResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  const all: Record<string, string> = { "content-type": "application/json", ...headers };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => all[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

export function publicUser(account: MockAccount | null) {
  if (!account) return null;
  return { username: account.username, email: account.email, organizations: [] };
}

/**
 * In-memory stand-in for the auth backend: accounts, the cookie session, the
 * change-password endpoint and both password-recovery endpoints.
 */
export function createMockServer(options: { session?: MockAccount | null } = {}): MockServer {
  const alice: MockAccount = {
    username: "alice-dev",
    email: "alice.dev@example.test",
    password: "Valid-password-123!",
  };
  const state: MockState = {
    accounts: [alice],
    session: options.session ?? null,
    registration: { status: 201, body: { account: { username: "pw-user-1" } } },
    passwordChange: { status: 200, body: { ok: true } },
    recoveryRequest: { status: 200, body: { code: "123456" } },
    recoveryCompletion: { status: 200, body: { ok: true } },
    requests: [],
  };

  function findAccount(identifier: unknown, password: unknown): MockAccount | undefined {
    return state.accounts.find(
      (account) =>
        (account.username === identifier || account.email === identifier)
        && account.password === password,
    );
  }

  function install() {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, "http://localhost").pathname;
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      state.requests.push({ method, path, body });

      if (path === "/api/session" && method === "GET") {
        return makeResponse(200, { user: publicUser(state.session) });
      }
      if (path === "/api/session" && method === "DELETE") {
        state.session = null;
        return makeResponse(200, { ok: true }, { "set-cookie": "sid=; Max-Age=0" });
      }
      if (path === "/api/sessions" && method === "POST") {
        const account = findAccount(body.identifier, body.password);
        if (!account) return makeResponse(401, { error: "Invalid credentials" });
        state.session = account;
        return makeResponse(200, { user: publicUser(account) });
      }
      if (path === "/api/accounts" && method === "POST") {
        return makeResponse(state.registration.status, state.registration.body);
      }
      if (path === "/api/account/password" && method === "POST") {
        if (!state.session) return makeResponse(401, { error: "Sign in is required to change the password" });
        if (state.passwordChange.status >= 400) {
          return makeResponse(state.passwordChange.status, state.passwordChange.body);
        }
        state.session.password = String(body.newPassword ?? "");
        return makeResponse(state.passwordChange.status, state.passwordChange.body);
      }
      if (path === "/api/password-recovery/requests" && method === "POST") {
        return makeResponse(state.recoveryRequest.status, state.recoveryRequest.body);
      }
      if (path === "/api/password-recovery/completions" && method === "POST") {
        if (state.recoveryCompletion.status >= 400) {
          return makeResponse(state.recoveryCompletion.status, state.recoveryCompletion.body);
        }
        const account = state.accounts.find((candidate) => candidate.email === body.email);
        if (account) account.password = String(body.password ?? "");
        return makeResponse(state.recoveryCompletion.status, state.recoveryCompletion.body);
      }
      return makeResponse(404, { error: "Not found" });
    }) as unknown as typeof fetch;
  }

  return { state, install };
}
