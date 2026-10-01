import { formatUpdatedAt } from "../organizations/OrganizationRepositories";
import type { RepositorySummary } from "./repository-api";

export interface RepositoryListProps {
  repositories: RepositorySummary[];
  /** Accessible name of the region that holds the list. */
  label?: string;
}

/**
 * Read-only repository list shared by the home page and the signed-in
 * workspace (REQ-3).
 *
 * Each entry is opened by the repository's "owner/repository name" identity,
 * next to the Public/Private marker, the description and the update time, so a
 * repository can be reached from a list as well as from search or a direct
 * address. The list only carries repositories the caller may read.
 */
export function RepositoryList({ repositories, label = "Repositories" }: RepositoryListProps) {
  if (repositories.length === 0) return null;

  return (
    <section className="repository-list" aria-label={label}>
      <h2>{label}</h2>
      <ul className="repository-list__items">
        {repositories.map((repository) => (
          <li
            key={`${repository.owner}/${repository.name}`}
            className="repository-list__item"
            aria-label={`${repository.fullName} ${repository.visibility === "public" ? "Public" : "Private"}`}
          >
            <div className="repository-list__heading">
              <a
                className="repository-list__name"
                href={`#/${repository.owner}/${repository.name}`}
              >
                {repository.fullName}
              </a>
              <span className="repository-list__visibility">
                {repository.visibility === "public" ? "Public" : "Private"}
              </span>
            </div>
            {repository.description ? (
              <p className="repository-list__description">{repository.description}</p>
            ) : null}
            <p className="repository-list__updated">Updated {formatUpdatedAt(repository.updatedAt)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
