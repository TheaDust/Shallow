import { useEffect, useRef, useState } from "react";

import { ApiError } from "../../lib/api";

export type ResourceState<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "denied" }
  | { status: "missing" }
  | { status: "error" };

/**
 * Loads one repository resource and maps the server answer onto the states the
 * repository pages share: 403 stays "denied" (a private repository never
 * reveals whether it exists) and 404 becomes "missing".
 */
export function useRepositoryResource<T>(
  key: string,
  enabled: boolean,
  load: () => Promise<T>,
): ResourceState<T> {
  const [state, setState] = useState<ResourceState<T>>({ status: "loading" });
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState({ status: "loading" });
    loadRef
      .current()
      .then((value) => {
        if (!cancelled) setState({ status: "ready", value });
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) {
          setState({ status: "denied" });
          return;
        }
        setState({
          status: error instanceof ApiError && error.status === 404 ? "missing" : "error",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, key]);

  return state;
}
