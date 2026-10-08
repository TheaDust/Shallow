import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "./api";

export interface AsyncError {
  message: string;
  status: number;
}

export interface AsyncState<T> {
  status: "loading" | "ready" | "error";
  data: T | null;
  error: AsyncError | null;
  reload(): void;
}

/**
 * Loads one required resource for a view. `deps` describes the identity the
 * data belongs to; `reload` re-runs the same loader after a mutation.
 */
export function useAsyncData<T>(load: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const loadRef = useRef(load);
  loadRef.current = load;
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<Omit<AsyncState<T>, "reload">>({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    let active = true;
    setState((previous) => ({ ...previous, status: "loading", error: null }));
    loadRef.current().then(
      (data) => {
        if (active) setState({ status: "ready", data, error: null });
      },
      (error: unknown) => {
        if (!active) return;
        const asyncError: AsyncError =
          error instanceof ApiError
            ? { message: error.message, status: error.status }
            : { message: "Unable to load this view", status: 0 };
        setState({ status: "error", data: null, error: asyncError });
      },
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { ...state, reload };
}
