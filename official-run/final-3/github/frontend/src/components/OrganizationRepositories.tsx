import { useState } from "react";

import { formatTimestamp } from "../lib/format";
import { fetchOrganizationRepositories, type RepositorySummary } from "../lib/org-api";
import { repositoryHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";
import { Combobox } from "../ui/Combobox";
import { FormField } from "../ui/FormField";
import { ErrorNote, LoadingNote } from "./ViewState";

type VisibilityFilter = "all" | "public" | "private";

const VISIBILITY_OPTIONS = [
  { value: "all", label: "All" },
  { value: "public", label: "Public" },
  { value: "private", label: "Private" },
] as const;

/**
 * Repositories tab of the organization overview. The server already returns
 * only the repositories the viewer may read, so the text filter can never
 * reveal a private repository and never needs a submit action.
 */
export function OrganizationRepositories({ organizationId }: { organizationId: string }) {
  const { status, data, error, reload } = useAsyncData(
    () => fetchOrganizationRepositories(organizationId),
    [organizationId],
  );
  const [query, setQuery] = useState("");
  const [visibility, setVisibility] = useState<VisibilityFilter>("all");

  if (status === "loading") return <LoadingNote label="Loading repositories…" />;
  if (status === "error") return error ? <ErrorNote error={error} onRetry={reload} /> : null;
  if (!data) return <LoadingNote label="Loading repositories…" />;

  const needle = query.trim().toLowerCase();
  const visible: RepositorySummary[] = data.filter(
    (repository) =>
      (needle === "" || repository.name.toLowerCase().includes(needle)) &&
      (visibility === "all" || repository.visibility === visibility),
  );

  return (
    <div className="org-repositories">
      <div className="org-repositories__filters">
        <FormField id="find-repository" label="Find a repository">
          <input
            id="find-repository"
            name="q"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </FormField>
        <Combobox
          id="repository-visibility"
          label="Visibility"
          options={VISIBILITY_OPTIONS}
          value={visibility}
          onChange={(event) => setVisibility(event.target.value as VisibilityFilter)}
        />
      </div>

      {visible.length === 0 ? (
        <p className="org-repositories__empty">No repositories matched your filter.</p>
      ) : (
        <ul className="repository-list">
          {visible.map((repository) => (
            <li key={repository.id} className="repository-list__item">
              <div className="repository-list__head">
                <a className="repository-list__name" href={repositoryHash(organizationId, repository.name)}>
                  {repository.name}
                </a>
                <span className="repository-list__visibility">
                  {repository.visibility === "public" ? "Public" : "Private"}
                </span>
              </div>
              {repository.description ? (
                <p className="repository-list__description">{repository.description}</p>
              ) : null}
              <p className="repository-list__updated">Updated {formatTimestamp(repository.updatedAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
