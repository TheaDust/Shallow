import { useState, type ChangeEvent } from "react";

import { FormField } from "../../ui/FormField";
import { organizationHash, repositoryHash } from "../../org/org-api";
import type { OrganizationDetail, RepositorySummary } from "../../org/types";
import { formatTimestamp } from "../../org/format";

type VisibilityFilter = "all" | "public" | "private";

export interface RepositoriesPanelProps {
  organization: OrganizationDetail;
  repositories: readonly RepositorySummary[];
  loadFailed?: boolean;
}

/**
 * REQ-2-1-1: the Repositories tab. The list only contains repositories the viewer
 * is allowed to read (the server decides), and filtering happens as the visitor
 * types — there is no submit action and no write operation on this page.
 */
export function RepositoriesPanel({ organization, repositories, loadFailed }: RepositoriesPanelProps) {
  const [query, setQuery] = useState("");
  const [visibility, setVisibility] = useState<VisibilityFilter>("all");

  const needle = query.trim().toLowerCase();
  const visible = repositories.filter((repository) => {
    if (visibility !== "all" && repository.visibility !== visibility) return false;
    if (!needle) return true;
    return repository.name.toLowerCase().includes(needle);
  });

  return (
    <section className="org-repositories" aria-label="Repositories">
      <div className="org-repositories__filters">
        <FormField id="find-repository" label="Find a repository">
          <input
            id="find-repository"
            name="find-repository"
            type="text"
            placeholder="Find a repository"
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
          />
        </FormField>
        <FormField id="repository-type" label="Type">
          <select
            id="repository-type"
            name="repository-type"
            value={visibility}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              setVisibility(event.target.value as VisibilityFilter)
            }
          >
            <option value="all">All</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </FormField>
      </div>
      {loadFailed ? (
        <p role="status">Unable to load the repositories of this organization.</p>
      ) : null}
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Description</th>
            <th scope="col">Visibility</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((repository) => (
            <tr key={repository.name}>
              <td>
                <a href={repositoryHash(organization.name, repository.name)}>{repository.name}</a>
              </td>
              <td>{repository.description}</td>
              <td>{repository.visibility === "private" ? "Private" : "Public"}</td>
              <td>Updated {formatTimestamp(repository.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {visible.length === 0 ? <p>No repositories match your filters.</p> : null}
      <p className="org-repositories__count">
        {visible.length} {visible.length === 1 ? "repository" : "repositories"}
      </p>
    </section>
  );
}
