import { repositoryCodeHref, repositoryHref } from "../../lib/repository-code-api";

export interface RepositoryBreadcrumbsProps {
  owner: string;
  name: string;
  branch: string;
  path: string;
  /** Route kind of the last segment: a directory ("tree") or a file ("blob"). */
  leaf: "tree" | "blob";
}

/**
 * Path breadcrumbs for a directory or file page. Every crumb except the last
 * opens the directory that contains the next segment, so the parent directory
 * is always one click away.
 */
export function RepositoryBreadcrumbs({
  owner,
  name,
  branch,
  path,
  leaf,
}: RepositoryBreadcrumbsProps) {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const crumbs = segments.map((segment, index) => {
    const isLast = index === segments.length - 1;
    return {
      label: segment,
      href: repositoryCodeHref(
        owner,
        name,
        isLast ? leaf : "tree",
        branch,
        segments.slice(0, index + 1).join("/"),
      ),
    };
  });

  return (
    <nav className="repository-breadcrumbs" aria-label="Breadcrumb">
      <ol>
        <li>
          <a href={repositoryHref(owner, name)}>{`${owner}/${name}`}</a>
        </li>
        {crumbs.map((crumb) => (
          <li key={crumb.href}>
            <a href={crumb.href}>{crumb.label}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
