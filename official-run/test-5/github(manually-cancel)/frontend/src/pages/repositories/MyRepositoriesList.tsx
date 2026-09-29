import { repositoryHash } from "../../org/org-api";
import type { RepositorySummary } from "../../repo/types";

export interface MyRepositoriesListProps {
  ownerName: string;
  repositories: readonly RepositorySummary[];
}

/**
 * The personal repositories of an account (REQ-3-2-1: a repository created in the
 * personal namespace appears in the owner's repository list). Each entry is a link
 * named exactly after the repository and shows its visibility and description.
 */
export function MyRepositoriesList({ ownerName, repositories }: MyRepositoriesListProps) {
  if (repositories.length === 0) return <p>No repositories yet.</p>;
  return (
    <ul className="repository-list">
      {repositories.map((repository) => (
        <li key={repository.name}>
          <a href={repositoryHash(ownerName, repository.name)}>{repository.name}</a>
          <span className="repository-list__visibility">
            {repository.visibility === "private" ? "Private" : "Public"}
          </span>
          {repository.description ? (
            <span className="repository-list__description">{repository.description}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
