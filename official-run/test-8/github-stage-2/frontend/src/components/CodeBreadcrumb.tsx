import { makeHash } from "../lib/hash-route";
import { blobPath, pathSegmentsOf, repositoryPath, treePath } from "../lib/repository-paths";

export interface CodeBreadcrumbProps {
  ownerLogin: string;
  repositoryName: string;
  /** The owner name shown as the first crumb (organization display name). */
  ownerName: string;
  branch: string;
  /** Repository-relative path of the current view; empty at the repository root. */
  path: string;
  /** Whether the last crumb is a file (its link is the file page itself). */
  kind: "directory" | "file";
}

/**
 * Repository and path breadcrumb of a code page. Directories link to their
 * listing, the last file crumb links to the file page it is already showing, so
 * every file page exposes an exact `README.md` link that survives a reload.
 */
export function CodeBreadcrumb({
  ownerLogin,
  repositoryName,
  ownerName,
  branch,
  path,
  kind,
}: CodeBreadcrumbProps) {
  const segments = pathSegmentsOf(path);
  return (
    <nav className="code-breadcrumb" aria-label="Breadcrumb">
      <a
        className="code-breadcrumb__repository"
        href={makeHash(repositoryPath(ownerLogin, repositoryName))}
      >
        {`${ownerName}/${repositoryName}`}
      </a>
      {segments.map((segment, index) => {
        const current = segments.slice(0, index + 1).join("/");
        const last = index === segments.length - 1;
        const href = last && kind === "file"
          ? blobPath(ownerLogin, repositoryName, branch, current)
          : treePath(ownerLogin, repositoryName, branch, current);
        return (
          <span className="code-breadcrumb__segment" key={current}>
            <span aria-hidden="true">/</span>
            <a
              className="code-breadcrumb__link"
              href={makeHash(href)}
              aria-current={last ? "page" : undefined}
            >
              {segment}
            </a>
          </span>
        );
      })}
    </nav>
  );
}
