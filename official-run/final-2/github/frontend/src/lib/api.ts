export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Fired when a signed-in area answers 401, which means the session cookie of
 * this browser is no longer usable (for example because another browser just
 * revoked it). The session provider re-reads /api/session and the app returns
 * to the sign-in page. A failed sign-in keeps its own local message.
 */
export const UNAUTHORIZED_EVENT = "shallowcode:unauthorized";

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    credentials: init.credentials ?? "same-origin",
    headers,
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    if (typeof body === "object" && body !== null) {
      const payload = body as { message?: unknown; error?: unknown };
      if (typeof payload.message === "string" && payload.message) message = payload.message;
      else if (typeof payload.error === "string" && payload.error) message = payload.error;
    }
    if (response.status === 401 && !path.startsWith("/api/auth/sign-in")) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(message, response.status, body);
  }
  return body as T;
}
