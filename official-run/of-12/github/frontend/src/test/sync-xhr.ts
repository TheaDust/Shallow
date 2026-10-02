import { vi } from "vitest";

export interface SyncXhrResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/**
 * Minimal synchronous `XMLHttpRequest` stand-in used by tests.
 *
 * The sign-in submit issues a blocking request (see `postJsonSync`) so the
 * session is committed before the form handler returns; jsdom would otherwise
 * perform a real network request. The handler mirrors the test's fetch mock and
 * answers synchronously.
 */
export function installSyncXhr(
  handler: (method: string, path: string, body: Record<string, unknown>) => SyncXhrResult,
): void {
  class FakeXmlHttpRequest {
    method = "GET";
    url = "";
    status = 0;
    responseText = "";
    private readonly headers: Record<string, string> = {};

    open(method: string, url: string): void {
      this.method = method.toUpperCase();
      this.url = url;
    }

    setRequestHeader(name: string, value: string): void {
      this.headers[name.toLowerCase()] = value;
    }

    send(body?: string | null): void {
      const path = new URL(this.url, "http://localhost").pathname;
      const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {};
      const result = handler(this.method, path, parsed);
      this.status = result.status;
      this.responseText = JSON.stringify(result.body ?? null);
    }
  }

  vi.stubGlobal("XMLHttpRequest", FakeXmlHttpRequest);
}
