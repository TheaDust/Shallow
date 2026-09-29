import { render, type RenderResult } from "@testing-library/react";
import { vi } from "vitest";

import { App } from "../App";

export interface MockRequest {
  url: string;
  method: string;
  body: unknown;
}

export interface MockResult {
  status: number;
  body: unknown;
}

export type MockHandler = (request: MockRequest) => MockResult;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Installs a fetch mock keyed by "METHOD /path". */
export function installFetch(handlers: Record<string, MockHandler>) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const path = new URL(raw, "http://localhost").pathname;
    const key = `${method} ${path}`;
    const handler = handlers[key];
    if (!handler) throw new Error(`Unexpected request: ${key}`);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const result = handler({ url: raw, method, body });
    return jsonResponse(result.status, result.body);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

export function renderApp(hashPath: string): RenderResult {
  window.location.hash = hashPath;
  return render(<App />);
}

export function signedOutSession(): MockResult {
  return { status: 200, body: { account: null, session: null } };
}

export function signedInSession(username: string, email: string): MockResult {
  return {
    status: 200,
    body: {
      account: { id: `acc-${username}`, username, email, emailVerified: true, status: "active" },
      session: { id: "session-1", active: true },
    },
  };
}
