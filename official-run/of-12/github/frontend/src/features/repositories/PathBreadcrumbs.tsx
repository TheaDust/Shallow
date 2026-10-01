import type { RepositorySummary } from "./repository-api";
import { codeHref, treeHref } from "./repository-links";

export interface PathBreadcrumbsProps {
  repository: RepositorySummary;
  branch: string;
  path: string;
  /**
   * Address of the current location when it stays a link. A file page passes
   * its own address, so the last segment is a link named exactly after the file
   * and opening the file from a code search result also yields a named link to
   * it (REQ-4-2-3); a directory page leaves it out.
   */
  currentHref?: string;
}

/**
 * Path breadcrumbs of a directory or file page (REQ-4-1): the repository name
 * leads back to the Code page and every parent directory of the current path is
 * a link, so the breadcrumbs return to the parent directory; the last segment
 * is the current location, spelled with its own name.
 */
export function PathBreadcrumbs({ repository, branch, path, currentHref }: PathBreadcrumbsProps) {
  const segments = path.split("/").filter(Boolean);
  return (
    <nav className="path-breadcrumbs" aria-label="Breadcrumb">
      <ol className="path-breadcrumbs__list">
        <li className="path-breadcrumbs__item">
          <a href={codeHref(repository, branch)}>{repository.name}</a>
        </li>
        {segments.map((segment, index) => {
          const partial = segments.slice(0, index + 1).join("/");
          const last = index === segments.length - 1;
          return (
            <li key={partial} className="path-breadcrumbs__item">
              <span aria-hidden="true">/</span>
              {last ? (
                currentHref ? (
                  <a
                    className="path-breadcrumbs__current"
                    href={currentHref}
                    aria-current="page"
                  >
                    {segment}
                  </a>
                ) : (
                  <span className="path-breadcrumbs__current" aria-current="page">
                    {segment}
                  </span>
                )
              ) : (
                <a href={treeHref(repository, branch, partial)}>{segment}</a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
