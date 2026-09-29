import { RepositoryAccessPage } from "../organizations/RepositoryAccessPage";
import { RepositorySettingsPage } from "../organizations/RepositorySettingsPage";
import { NotFoundPage } from "../common";
import { NewRepositoryPage } from "./NewRepositoryPage";
import { RepositoryBlobPage } from "./RepositoryBlobPage";
import { RepositoryCodePage } from "./RepositoryCodePage";
import { RepositoryCommitsPage } from "./RepositoryCommitsPage";
import { RepositoryOverviewPage } from "./RepositoryOverviewPage";
import { RepositoryWorkItemPage } from "./RepositoryWorkItemPage";
import { YourRepositoriesPage } from "./YourRepositoriesPage";

/**
 * Hash routes of the repository module (REQ-3):
 *
 *   #/repositories                       the signed-in account's repositories
 *   #/repositories/new                   the creation form (also #/new)
 *   #/repositories/:owner/:repository            overview
 *   #/repositories/:owner/:repository/code       file list of the default branch
 *   #/repositories/:owner/:repository/tree/:branch/:path
 *   #/repositories/:owner/:repository/blob/:branch/:path
 *   #/repositories/:owner/:repository/commits
 *   #/repositories/:owner/:repository/issues | /pulls
 *   #/repositories/:owner/:repository/settings[/access]
 *
 * An owner segment is either an individual account or an organization; the server
 * decides which namespaces and repositories the viewer may read.
 */
export function RepositoryRoutes({ segments }: { segments: readonly string[] }) {
  const [ownerName, repositoryName, section, ...rest] = segments;

  if (!ownerName) return <YourRepositoriesPage />;
  if (ownerName === "new") return <NewRepositoryPage />;
  if (!repositoryName) return <NotFoundPage />;

  switch (section) {
    case undefined:
      return <RepositoryOverviewPage ownerName={ownerName} repositoryName={repositoryName} />;
    case "code":
      return <RepositoryCodePage ownerName={ownerName} repositoryName={repositoryName} />;
    case "tree":
    case "blob": {
      const [branch, ...pathSegments] = rest;
      if (!branch) return <NotFoundPage />;
      const path = pathSegments.join("/");
      if (section === "tree") {
        return (
          <RepositoryCodePage
            ownerName={ownerName}
            repositoryName={repositoryName}
            branch={branch}
            path={path}
          />
        );
      }
      if (!path) return <NotFoundPage />;
      return (
        <RepositoryBlobPage
          ownerName={ownerName}
          repositoryName={repositoryName}
          branch={branch}
          path={path}
        />
      );
    }
    case "commits":
      return <RepositoryCommitsPage ownerName={ownerName} repositoryName={repositoryName} />;
    case "issues":
      return (
        <RepositoryWorkItemPage
          ownerName={ownerName}
          repositoryName={repositoryName}
          kind="issues"
          heading="Issues"
          emptyMessage="No open issues yet."
        />
      );
    case "pulls":
      return (
        <RepositoryWorkItemPage
          ownerName={ownerName}
          repositoryName={repositoryName}
          kind="pulls"
          heading="Pull requests"
          emptyMessage="No open pull requests yet."
        />
      );
    case "settings":
      if (!rest.length) {
        return <RepositorySettingsPage ownerName={ownerName} repositoryName={repositoryName} />;
      }
      if (rest[0] === "access") {
        return <RepositoryAccessPage ownerName={ownerName} repositoryName={repositoryName} />;
      }
      return <NotFoundPage />;
    default:
      return <NotFoundPage />;
  }
}
