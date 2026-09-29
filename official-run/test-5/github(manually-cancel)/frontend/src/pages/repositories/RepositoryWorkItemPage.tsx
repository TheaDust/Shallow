import { fetchRepository } from "../../org/org-api";
import { useAsyncData } from "../../org/use-async-data";
import { AccessDeniedMain, BusyMain, NotFoundPage } from "../common";
import { RepositoryShell } from "./RepositoryShell";

export interface RepositoryWorkItemPageProps {
  ownerName: string;
  repositoryName: string;
  kind: "issues" | "pulls";
  heading: string;
  emptyMessage: string;
}

/**
 * Entry target of the “Issues” and “Pull requests” links of the repository pages.
 * The repository module only owns the entry points (REQ-3-3): the list itself and
 * its work items are the subject of the issue and pull-request requirements, so
 * these pages render the repository frame with an explicit empty state.
 */
export function RepositoryWorkItemPage({
  ownerName,
  repositoryName,
  kind,
  heading,
  emptyMessage,
}: RepositoryWorkItemPageProps) {
  const repository = useAsyncData(
    () => fetchRepository(ownerName, repositoryName),
    [ownerName, repositoryName],
  );

  if (repository.status === "loading") return <BusyMain />;
  if (repository.status === "error" || !repository.data) {
    if (repository.error && (repository.error.status === 401 || repository.error.status === 403)) {
      return <AccessDeniedMain />;
    }
    return <NotFoundPage />;
  }

  return (
    <RepositoryShell repository={repository.data} active={kind}>
      <h2>{heading}</h2>
      <p role="status">{emptyMessage}</p>
    </RepositoryShell>
  );
}
