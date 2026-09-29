import { fetchOrganization, fetchOrganizationRepositories } from "../../org/org-api";
import { useAsyncData } from "../../org/use-async-data";
import { BusyMain, NotFoundPage } from "../common";
import { OrganizationShell } from "./OrganizationShell";
import { RepositoriesPanel } from "./RepositoriesPanel";

export interface OrganizationRepositoriesPageProps {
  organizationName: string;
}

/**
 * REQ-2-1-1: the Repositories tab (also the default organization overview view).
 * A visitor only ever receives the public repositories of the organization.
 */
export function OrganizationRepositoriesPage({ organizationName }: OrganizationRepositoriesPageProps) {
  const organization = useAsyncData(() => fetchOrganization(organizationName), [organizationName]);
  const repositories = useAsyncData(
    () => fetchOrganizationRepositories(organizationName),
    [organizationName],
  );

  if (organization.status === "loading" || repositories.status === "loading") return <BusyMain />;
  if (organization.status === "error" || !organization.data) return <NotFoundPage />;

  return (
    <OrganizationShell organization={organization.data} activeTab="repositories">
      <RepositoriesPanel
        organization={organization.data}
        repositories={repositories.data ?? []}
        loadFailed={repositories.status === "error"}
      />
    </OrganizationShell>
  );
}
