import {
  repositoryBlobHref,
  repositoryTreeHref,
} from "../lib/repository-routes";

export interface RepositoryBreadcrumbsProps {
  owner: string;
  name: string;
  branch: string;
  /** Path of the current view; "" is the repository root of the branch. */
  path: string;
  /** Whether the last path segment is a file (the whole path is read) or a directory. */
  leaf: "file" | "dir";
}

/** The path without its last segment; "" for a top-level entry. */
export function parentPathOf(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.slice(0, -1).join("/");
}

/**
 * Path breadcrumbs of a directory or file page: the repository root, every
 * parent directory as a link that returns to that directory, and the current
 * entry as a link to the address being read.
 */
export function RepositoryBreadcrumbs({
  owner,
  name,
  branch,
  path,
  leaf,
}: RepositoryBreadcrumbsProps) {
  const segments = path.split("/").filter(Boolean);

  return (
    <nav className="repository-breadcrumbs" aria-label="Breadcrumb">
      <ol>
        <li className="repository-breadcrumbs__item">
          <a href={repositoryTreeHref(owner, name, branch)}>{name}</a>
        </li>
        {segments.map((segment, index) => {
          const segmentPath = segments.slice(0, index + 1).join("/");
          const isLeaf = index === segments.length - 1;
          const href =
            isLeaf && leaf === "file"
              ? repositoryBlobHref(owner, name, branch, segmentPath)
              : repositoryTreeHref(owner, name, branch, segmentPath);
          return (
            <li key={segmentPath} className="repository-breadcrumbs__item">
              <a href={href} aria-current={isLeaf ? "page" : undefined}>
                {segment}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
