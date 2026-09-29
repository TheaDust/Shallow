import { fetchMyOrganizations, fetchPublicOrganizations, organizationHash } from "../org/org-api";
import { fetchMyRepositories, newRepositoryHash } from "../repo/repo-api";
import { useAsyncData } from "../org/use-async-data";
import type { OrganizationSummary } from "../org/types";
import { useSession } from "../session/SessionProvider";
import { BusyMain } from "./common";
import { MyRepositoriesList } from "./repositories/MyRepositoriesList";

function OrganizationLinks({ organizations }: { organizations: readonly OrganizationSummary[] }) {
  if (organizations.length === 0) return <p>No organizations to show yet.</p>;
  return (
    <ul className="organization-list">
      {organizations.map((organization) => (
        <li key={organization.name}>
          <a href={organizationHash(organization.name)}>{organization.name}</a>
        </li>
      ))}
    </ul>
  );
}

/**
 * REQ-2-1-1: the home page is the discovery entry — a visitor can open a public
 * organization page, a signed-in account sees the organizations it belongs to.
 */
export function HomePage() {
  const { status, account } = useSession();
  const username = account?.username ?? null;
  const mine = useAsyncData(
    () => (username ? fetchMyOrganizations() : Promise.resolve([])),
    [username],
  );
  const repositories = useAsyncData(
    () => (username ? fetchMyRepositories() : Promise.resolve([])),
    [username],
  );
  const directory = useAsyncData(() => fetchPublicOrganizations(), []);

  if (status === "loading") return <BusyMain />;

  if (!account) {
    return (
      <main>
        <h1>Home</h1>
        <p>
          A simplified collaboration platform for repositories, issues, and pull requests. Sign in
          or create an account to start collaborating.
        </p>
        <h2>Public organizations</h2>
        {directory.status === "loading" ? <p role="status">Loading organizations…</p> : null}
        {directory.status === "error" ? <p role="status">Unable to load organizations.</p> : null}
        {directory.status === "ready" ? (
          <OrganizationLinks organizations={directory.data ?? []} />
        ) : null}
      </main>
    );
  }

  return (
    <main>
      <h1>Workspace</h1>
      <p>
        You are signed in. Open the account menu in the upper-right corner to reach your settings or
        sign out.
      </p>
      <h2>Your repositories</h2>
      <p>
        <a href={newRepositoryHash()}>New repository</a>
      </p>
      {repositories.status === "loading" ? <p role="status">Loading repositories…</p> : null}
      {repositories.status === "error" ? (
        <p role="alert">Unable to load your repositories.</p>
      ) : null}
      {repositories.status === "ready" ? (
        <MyRepositoriesList ownerName={account.username} repositories={repositories.data ?? []} />
      ) : null}
      <h2>Your organizations</h2>
      {mine.status === "loading" ? <p role="status">Loading organizations…</p> : null}
      {mine.status === "error" ? <p role="status">Unable to load your organizations.</p> : null}
      {mine.status === "ready" ? <OrganizationLinks organizations={mine.data ?? []} /> : null}
    </main>
  );
}
