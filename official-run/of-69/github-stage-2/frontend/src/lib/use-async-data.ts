import { useCallback, useEffect, useState } from "react";

import { ApiError } from "./api";

export interface AsyncData<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload(): void;
}

export function apiErrorMessage(error: unknown, fallback = "Unable to load this page."): string {
  if (error instanceof ApiError) {
    const body = error.body;
    if (body && typeof body === "object" && "error" in body) {
      const message = (body as { error?: unknown }).error;
      if (typeof message === "string" && message.length > 0) return message;
    }
    return error.message;
  }
  return fallback;
}

/**
 * Loads one page's data against the same-origin API. The page keeps its
 * navigation and form structure while loading; only the data area reflects the
 * busy state, and a failed load stays recoverable through `reload`.
 */
export function useAsyncData<T>(loader: () => Promise<T>, deps: readonly unknown[]): AsyncData<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loader().then(
      (value) => {
        if (!active) return;
        setData(value);
        setError(null);
        setLoading(false);
      },
      (caught) => {
        if (!active) return;
        setData(null);
        setError(apiErrorMessage(caught));
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
    // `deps` describes the request identity; `nonce` forces an explicit reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, error, loading, reload };
}
