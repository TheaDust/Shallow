import { AppHeader } from "../../components/AppHeader";
import { RepoOwnerType } from "../../lib/repo-api";
import { useSession } from "../../session";
import { RepoOverview, RepoSection } from "./RepoOverview";
import { useRepoDetail } from "./useRepoDetail";

interface RepositoryViewProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
  section: RepoSection;
  branch?: string;
  path?: string;
}

/**
 * Repository code page for both personal and organization repositories. A
 * private repository without permission shows an access-denied state instead
 * of its content; the heading stays visible either way. `branch` and `path`
 * select the file snapshot and directory shown by the file browser.
 */
export function RepositoryView({ ownerType, ownerName, repoName, section, branch, path }: RepositoryViewProps) {
  const { status } = useSession();
  const { status: detailStatus, repository } = useRepoDetail(ownerType, ownerName, repoName, branch);

  if (detailStatus === "notfound") {
    return (
      <AppHeader>
        <main>
          <h1>{ownerName}/{repoName}</h1>
          <p>Repository not found.</p>
        </main>
      </AppHeader>
    );
  }

  if (detailStatus === "denied") {
    return (
      <AppHeader>
        <main>
          <h1>{ownerName}/{repoName}</h1>
          <p>Access denied</p>
          {status !== "authenticated" && (
            <p>
              <a href="#/signin">Sign in</a>
            </p>
          )}
        </main>
      </AppHeader>
    );
  }

  if (detailStatus !== "ready" || !repository) {
    return (
      <AppHeader>
        <main>
          <h1>{ownerName}/{repoName}</h1>
          <p>Loading…</p>
        </main>
      </AppHeader>
    );
  }

  return (
    <AppHeader>
      <RepoOverview
        ownerType={ownerType}
        ownerName={ownerName}
        repoName={repoName}
        repository={repository}
        section={section}
        branch={branch}
        path={path}
      />
    </AppHeader>
  );
}
