import { useState } from "react";

import { fetchOrganizationRepositories, type RepositoryVisibility } from "../../api/organizations";
import { makeHash } from "../../lib/hash-route";
import { useAsyncData } from "../../lib/useAsyncData";
import { FormField } from "../../ui";

function formatUpdatedAt(value: string | null): string {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
}

const VISIBILITY_LABEL: Record<RepositoryVisibility, string> = {
  public: "Public",
  private: "Private",
};

/**
 * The “Repositories” tab. Filtering runs entirely in the browser as the user
 * types; the server has already narrowed the list to repositories this viewer
 * may read, so a private repository can never appear for a visitor.
 */
export function RepositoriesPanel({ slug }: { slug: string }) {
  const { data, error, loading } = useAsyncData(() => fetchOrganizationRepositories(slug), [slug]);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | RepositoryVisibility>("all");

  const repositories = data?.repositories ?? [];
  const normalizedQuery = query.trim().toLowerCase();
  const visible = repositories
    .filter((repository) => (normalizedQuery ? repository.name.toLowerCase().includes(normalizedQuery) : true))
    .filter((repository) => (type === "all" ? true : repository.visibility === type));

  return (
    <section className="organization-panel">
      {loading ? (
        <p role="status">Loading…</p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <FormField id={`find-repository-${slug}`} label="Find a repository">
        <input
          id={`find-repository-${slug}`}
          name="repositoryFilter"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </FormField>
      <div className="ui-field">
        <label htmlFor={`repository-type-${slug}`}>Type</label>
        <select
          id={`repository-type-${slug}`}
          name="repositoryType"
          value={type}
          onChange={(event) => setType(event.target.value as "all" | RepositoryVisibility)}
        >
          <option value="all">All</option>
          <option value="public">Public</option>
          <option value="private">Private</option>
        </select>
      </div>
      {!loading && !error ? (
        visible.length > 0 ? (
          <ul className="repository-list">
            {visible.map((repository) => (
              <li key={repository.id} className="repository-list__item">
                <a className="repository-list__link" href={makeHash(`/repositories/${slug}/${repository.name}`)}>
                  {repository.name}
                </a>
                <p className="repository-list__description">{repository.description}</p>
                <p className="repository-list__meta">
                  {VISIBILITY_LABEL[repository.visibility]} · Updated {formatUpdatedAt(repository.updatedAt)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="repository-list__empty">No repositories found.</p>
        )
      ) : null}
    </section>
  );
}
