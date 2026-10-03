import { organizationHeading, OrganizationLayout } from "../components/OrganizationLayout";
import { fetchOrganization } from "../lib/organization-api";
import { useAsyncData } from "../lib/use-async-data";
import { useSession } from "../session/session-context";

/**
 * Organization overview. The heading is the organization name, and the
 * “Repositories”, “People” and “Teams” entries lead to the organization pages.
 */
export function OrganizationOverviewPage({ organization }: { organization: string }) {
  const { account } = useSession();
  const detail = useAsyncData(() => fetchOrganization(organization), [organization]);

  return (
    <OrganizationLayout
      organizationName={organization}
      organization={detail.data?.organization ?? null}
      heading={detail.data ? organizationHeading(detail.data.organization) : organization}
      activeTab="overview"
      account={account}
      showOrganizationLink={false}
    >
      {detail.loading ? <p role="status">Loading organization…</p> : null}
      {detail.error ? (
        <p className="form-error" role="alert">
          {detail.error}
        </p>
      ) : null}
      {detail.data ? (
        <p className="page-hint">
          Repositories owned by this organization are listed under “Repositories”; membership and team governance live
          under “People” and “Teams”.
        </p>
      ) : null}
    </OrganizationLayout>
  );
}
