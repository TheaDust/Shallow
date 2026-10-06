import { repositoryBlobHash, repositoryCodeHash, repositoryHash } from "../lib/routes";
import type { RepositorySummary } from "../lib/org-api";

/**
 * Repository location line shared by the code, file, history and search views:
 * the repository link followed by the path segments of the current view. A view
 * of a file ends in a link to that stored file, so the file page always exposes
 * its own name as a link.
 */
export function RepositoryBreadcrumb({
  repository,
  path = "",
  file = false,
  branch,
}: {
  repository: RepositorySummary;
  path?: string;
  file?: boolean;
  /** A non-default branch keeps its snapshot in the address of every link. */
  branch?: string;
}) {
  const segments = path ? path.split("/") : [];
  const owner = repository.owner.id;
  const name = repository.name;

  return (
    <nav className="repository__breadcrumb" aria-label="Breadcrumb">
      <a href={repositoryHash(owner, name)}>
        {repository.owner.displayName}/{name}
      </a>
      {segments.map((segment, index) => {
        const prefix = segments.slice(0, index + 1).join("/");
        const isLast = index === segments.length - 1;
        if (isLast && !file) {
          return (
            <span key={prefix}>
              <span className="repository__breadcrumb-separator"> / </span>
              {segment}
            </span>
          );
        }
        return (
          <span key={prefix}>
            <span className="repository__breadcrumb-separator"> / </span>
            <a href={isLast ? repositoryBlobHash(owner, name, prefix, branch) : repositoryCodeHash(owner, name, prefix, branch)}>
              {segment}
            </a>
          </span>
        );
      })}
    </nav>
  );
}
