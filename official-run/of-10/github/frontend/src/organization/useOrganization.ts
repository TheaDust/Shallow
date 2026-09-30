import { useCallback, useEffect, useState } from "react";

import {
  fetchOrganization,
  type OrganizationSummary,
  type OrganizationViewer,
} from "../lib/organizations-api";

export type OrganizationLoadState =
  | { status: "loading" }
  | { status: "ready"; organization: OrganizationSummary; viewer: OrganizationViewer }
  | { status: "missing" }
  | { status: "error" };

export interface OrganizationLoader {
  state: OrganizationLoadState;
  reload(): void;
}

/**
 * Loads one organization and the viewer's membership from the server, so every
 * organization page decides what to show from the persisted relationship
 * instead of a client-side guess.
 */
export function useOrganization(login: string): OrganizationLoader {
  const [state, setState] = useState<OrganizationLoadState>({ status: "loading" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    fetchOrganization(login)
      .then(
        (detail) => {
          if (active) {
            setState({
              status: "ready",
              organization: detail.organization,
              viewer: detail.viewer,
            });
          }
        },
        (error: unknown) => {
          if (!active) return;
          const status = (error as { status?: number }).status;
          setState({ status: status === 404 ? "missing" : "error" });
        },
      );
    return () => {
      active = false;
    };
  }, [login, version]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);

  return { state, reload };
}
