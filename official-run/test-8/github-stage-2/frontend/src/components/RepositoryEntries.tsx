import type { RepositorySummary } from "../api/organizations";
import { makeHash } from "../lib/hash-route";

/**
 * One entry per readable repository. The link text is exactly the repository
 * name — the `owner/name` metadata is a sibling, not part of the link — so the
 * same entry works for search results and for the explore/workspace lists.
 */
export function RepositoryEntries({ repositories }: { repositories: RepositorySummary[] }) {
  return (
    <ul className="repository-list">
      {repositories.map((repository) => (
        <li key={repository.id} className="repository-list__item">
          <a
            className="repository-list__link"
            href={makeHash(`/repositories/${repository.owner?.login ?? ""}/${repository.name}`)}
          >
            {repository.name}
          </a>
          <p className="repository-list__meta">
            {`${repository.owner?.displayName ?? ""}/${repository.name}`}
          </p>
        </li>
      ))}
    </ul>
  );
}
