import { fetchMyRepositories, newRepositoryHash } from "../../repo/repo-api";
import { useAsyncData } from "../../org/use-async-data";
import { useSession } from "../../session/SessionProvider";
import { AuthenticationRequired, BusyMain } from "../common";
import { MyRepositoriesList } from "./MyRepositoriesList";

/**
 * `#/repositories` — the repository list of the signed-in account. It is the
 * personal counterpart of an organization's Repositories tab and is directly
 * addressable, so a created repository can be reopened or refreshed from here.
 */
export function YourRepositoriesPage() {
  const { status, account } = useSession();
  const username = account?.username ?? null;
  const repositories = useAsyncData(
    () => (username ? fetchMyRepositories() : Promise.resolve([])),
    [username],
  );

  if (status === "loading") return <BusyMain />;
  if (!account) return <AuthenticationRequired />;

  return (
    <main>
      <h1>Your repositories</h1>
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
    </main>
  );
}
