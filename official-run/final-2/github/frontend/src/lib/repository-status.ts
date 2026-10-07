import type { RepositoryDetail } from "./org-api";

/**
 * The repository status of the archive/restore flow (REQ-3-5). The settings
 * panel confirms the dialog and leaves for the repository overview before the
 * request settles, because the overview is the view that carries the `Archived`
 * marker and its address must be the one a reload returns to. The outcome is
 * therefore published here so the overview applies the returned record (or
 * reports why nothing changed). A plain window event keeps both views
 * independent, like `UNAUTHORIZED_EVENT` in `api.ts`.
 */
export type RepositoryStatusEvent =
  | { kind: "settled"; owner: string; name: string; repository: RepositoryDetail }
  | { kind: "failed"; owner: string; name: string; message: string };

const REPOSITORY_STATUS_EVENT = "shallowcode:repository-status";

export function publishRepositoryStatus(event: RepositoryStatusEvent): void {
  window.dispatchEvent(new CustomEvent<RepositoryStatusEvent>(REPOSITORY_STATUS_EVENT, { detail: event }));
}

export function subscribeRepositoryStatus(
  listener: (event: RepositoryStatusEvent) => void,
): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<RepositoryStatusEvent>).detail);
  };
  window.addEventListener(REPOSITORY_STATUS_EVENT, handler);
  return () => window.removeEventListener(REPOSITORY_STATUS_EVENT, handler);
}
