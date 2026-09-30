import { makeHash } from "../lib/hash-route";
import { repositoryOverviewHref, repositorySubPath } from "../lib/repository-routes";
import { repositoryVisibilityLabel, type RepositoryVisibility } from "../lib/repositories-api";

export type RepositoryEntry = "Code" | "Issues" | "Pull requests" | "Settings";

export interface RepositoryChromeProps {
  owner: string;
  name: string;
  /** The heading label: `owner/name`, or the organization display name for an organization repository. */
  title: string;
  visibility: RepositoryVisibility;
  description?: string;
  activeEntry: RepositoryEntry;
}

/**
 * Repository identity and navigation shared by every repository page: the
 * heading, the visibility marker and the Code/Issues/Pull requests/Settings
 * entries. "Code" is a navigation link and is unrelated to the clone-menu
 * button of the same name.
 */
export function RepositoryChrome({
  owner,
  name,
  title,
  visibility,
  description,
  activeEntry,
}: RepositoryChromeProps) {
  const entries: Array<{ label: RepositoryEntry; href: string }> = [
    { label: "Code", href: repositoryOverviewHref(owner, name) },
    { label: "Issues", href: makeHash(repositorySubPath(owner, name, "issues")) },
    { label: "Pull requests", href: makeHash(repositorySubPath(owner, name, "pulls")) },
    { label: "Settings", href: makeHash(repositorySubPath(owner, name, "settings")) },
  ];

  return (
    <header className="repository-chrome">
      <h1 className="repository-chrome__title">{title}</h1>
      <p className="repository-chrome__marker">
        <span className="visibility-badge" data-visibility={visibility}>
          {repositoryVisibilityLabel(visibility)}
        </span>
      </p>
      <nav className="repository-nav" aria-label="Repository">
        {entries.map((entry) => (
          <a
            key={entry.label}
            href={entry.href}
            aria-current={entry.label === activeEntry ? "page" : undefined}
          >
            {entry.label}
          </a>
        ))}
      </nav>
      {description ? <p className="repository-chrome__description">{description}</p> : null}
    </header>
  );
}
