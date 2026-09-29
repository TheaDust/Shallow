import { fetchRepository, repositoryAccessHash, repositoryHash } from "../../org/org-api";
import { useAsyncData } from "../../org/use-async-data";
import { AccessDeniedMain, BusyMain, NotFoundPage } from "../common";

export interface RepositorySettingsPageProps {
  ownerName: string;
  repositoryName: string;
}

/**
 * REQ-2-3: the repository “Settings” page. It links to “Manage access”, where an
 * organization Owner or repository Admin grants repository roles. A personal
 * repository has no organization subjects to grant, so the entry stays hidden
 * (its direct grants are still honoured by the server).
 */
export function RepositorySettingsPage({ ownerName, repositoryName }: RepositorySettingsPageProps) {
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

  const detail = repository.data;
  return (
    <main>
      <h1>Settings</h1>
      <p>
        <a href={repositoryHash(detail.ownerName, detail.name)}>{detail.fullName}</a>
      </p>
      {detail.ownerType !== "account" ? (
        <p>
          <a href={repositoryAccessHash(detail.ownerName, detail.name)}>Manage access</a>
        </p>
      ) : null}
    </main>
  );
}
