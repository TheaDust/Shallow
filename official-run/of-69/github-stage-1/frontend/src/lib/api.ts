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

export function apiFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  const body = error.body;
  if (!body || typeof body !== "object" || !("errors" in body)) return {};
  const errors = (body as { errors?: unknown }).errors;
  if (!errors || typeof errors !== "object") return {};
  return errors as Record<string, string>;
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
