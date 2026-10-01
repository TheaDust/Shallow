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

export interface SyncJsonResponse<T> {
  status: number;
  body: T | null;
}

/**
 * Blocking JSON POST used by the sign-in submit (REQ-1-1-2).
 *
 * The account-access page is left as soon as the credentials are accepted, and
 * the user (or an automation step) may reload or reopen the page in the very
 * next moment. A regular asynchronous request would only commit the session
 * cookie once its response is processed, so an immediate reload could still
 * load the sign-in page without a session. Issuing the sign-in request
 * synchronously guarantees that the session cookie and the account response
 * exist before the submit handler continues, so the next document load already
 * resolves the signed-in account.
 */
export function postJsonSync<T>(path: string, body: unknown): SyncJsonResponse<T> {
  const request = new XMLHttpRequest();
  request.open("POST", path, false);
  request.setRequestHeader("content-type", "application/json");
  request.send(JSON.stringify(body));
  let parsed: T | null = null;
  try {
    parsed = request.responseText ? (JSON.parse(request.responseText) as T) : null;
  } catch {
    parsed = null;
  }
  return { status: request.status, body: parsed };
}

export interface MutationErrors {
  errors: Record<string, string>;
  message: string;
}

export type MutationOutcome<T> = { ok: true; data: T } | ({ ok: false } & MutationErrors);

/**
 * Shared JSON write helper: the server's field messages are returned verbatim,
 * so a form can render them next to the failing input instead of guessing.
 */
export async function mutateJson<T>(path: string, init: RequestInit): Promise<MutationOutcome<T>> {
  try {
    return { ok: true, data: await apiRequest<T>(path, init) };
  } catch (error) {
    if (error instanceof ApiError) {
      const body = error.body as { fields?: Record<string, string>; error?: string } | null;
      return { ok: false, errors: body?.fields ?? {}, message: body?.error ?? error.message };
    }
    return { ok: false, errors: {}, message: "The request could not be completed right now." };
  }
}

/**
 * Blocking counterpart of `mutateJson`, used by a submit that changes the
 * address of the page (REQ-4-4).
 *
 * The file editor replaces the current view with the stored file as soon as the
 * change is accepted; a regular asynchronous request would leave the editor
 * address active until its response is processed, so a reload, a refresh or a
 * reopen in the very next moment could still show the editor without the saved
 * file. Issuing the request synchronously means the destination address is
 * already active when the submit handler returns, exactly like the sign-in
 * submit of REQ-1-1-2.
 */
export function mutateJsonSync<T>(path: string, body: unknown): MutationOutcome<T> {
  let response: SyncJsonResponse<T & { fields?: Record<string, string>; error?: string }>;
  try {
    response = postJsonSync<T & { fields?: Record<string, string>; error?: string }>(path, body);
  } catch {
    return { ok: false, errors: {}, message: "The request could not be completed right now." };
  }
  const payload = response.body;
  if (response.status >= 200 && response.status < 300 && payload) {
    return { ok: true, data: payload };
  }
  return {
    ok: false,
    errors: payload?.fields ?? {},
    message: payload?.error ?? "The request could not be completed right now.",
  };
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
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
    const message = typeof body === "object" && body !== null && "error" in body
      ? String(body.error)
      : `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, body);
  }
  return body as T;
}
