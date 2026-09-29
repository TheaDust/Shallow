import { ApiError, apiRequest } from "./api";

interface FieldErrors<TErrors> {
  errors?: TErrors;
}

/**
 * Turns a `400 { errors }` answer into field errors; every other failure re-throws
 * so the caller can show a generic message. Shared by the organization and
 * repository forms, which both report field errors beside their inputs.
 */
export async function postForm<TResult, TErrors>(
  path: string,
  method: "POST" | "PUT",
  body: unknown,
): Promise<{ ok: true; result: TResult } | { ok: false; errors: TErrors }> {
  try {
    const result = await apiRequest<TResult>(path, { method, body: JSON.stringify(body) });
    return { ok: true, result };
  } catch (error) {
    if (error instanceof ApiError) {
      const payload = error.body as FieldErrors<TErrors> | null;
      if (error.status === 400 && payload && typeof payload === "object" && payload.errors) {
        return { ok: false, errors: payload.errors };
      }
    }
    throw error;
  }
}
