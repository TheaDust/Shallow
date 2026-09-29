import { useEffect, useRef, useState } from "react";

import { ApiError } from "../lib/api";

export interface AsyncState<T> {
  status: "loading" | "ready" | "error";
  data: T | null;
  error: ApiError | null;
}

export interface AsyncResource<T> extends AsyncState<T> {
  reload(): void;
}

function toApiError(value: unknown): ApiError {
  return value instanceof ApiError
    ? value
    : new ApiError(value instanceof Error ? value.message : "Request failed", 0, null);
}

/**
 * Loads a resource for the current view. While the first load is in flight the
 * caller renders its busy state; `reload()` refetches after a successful write so
 * the page shows the persisted result rather than the optimistic one.
 */
export function useAsyncData<T>(load: () => Promise<T>, deps: readonly unknown[]): AsyncResource<T> {
  const loadRef = useRef(load);
  loadRef.current = load;
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<AsyncState<T>>({ status: "loading", data: null, error: null });

  useEffect(() => {
    let active = true;
    setState((current) => ({ status: "loading", data: current.data, error: null }));
    loadRef.current().then(
      (data) => {
        if (active) setState({ status: "ready", data, error: null });
      },
      (error: unknown) => {
        if (active) setState({ status: "error", data: null, error: toApiError(error) });
      },
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { ...state, reload: () => setNonce((value) => value + 1) };
}
