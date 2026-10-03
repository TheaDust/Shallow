import { useEffect, useState } from "react";

import { OrganizationLayout } from "../components/OrganizationLayout";
import { fetchOrganizationRepositories } from "../lib/organization-api";
import { replaceHash, useHashLocation } from "../lib/hash-route";
import { organizationUrl } from "../lib/routes";
import { useAsyncData } from "../lib/use-async-data";
import { useSession } from "../session/session-context";
import { Combobox, FormField } from "../ui";

const VISIBILITY_OPTIONS = [
  { value: "all", label: "All" },
  { value: "public", label: "Public" },
  { value: "private", label: "Private" },
] as const;

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
}

/**
 * Organization repositories. The list shows only repositories the current
 * viewer may read, and the name filter narrows the result as the user types
 * (the filter state lives in the URL so Back returns to the same result).
 */
export function OrganizationRepositoriesPage({ organization }: { organization: string }) {
  const { account } = useSession();
  const detail = useAsyncData(() => fetchOrganizationRepositories(organization), [organization]);
  const location = useHashLocation();
  // The filter is mirrored into the URL, so a result opened and returned to
  // with browser Back shows the same list again.
  const [query, setQuery] = useState(() => location.search.get("q") ?? "");
  const [visibility, setVisibility] = useState(() => location.search.get("visibility") ?? "all");
  const locationKey = `${location.path}?${location.search.toString()}`;

  useEffect(() => {
    setQuery(location.search.get("q") ?? "");
    setVisibility(location.search.get("visibility") ?? "all");
  }, [locationKey]);

  function applyFilter(nextQuery: string, nextVisibility: string) {
    const params = new URLSearchParams();
    if (nextQuery) params.set("q", nextQuery);
    if (nextVisibility && nextVisibility !== "all") params.set("visibility", nextVisibility);
    replaceHash(`/organizations/${encodeURIComponent(organization)}/repositories`, params);
  }

  const trimmedQuery = query.trim().toLowerCase();
  const repositories = (detail.data?.repositories ?? []).filter(
    (repository) =>
      repository.name.toLowerCase().includes(trimmedQuery) &&
      (visibility === "all" || repository.visibility === visibility),
  );

  return (
    <OrganizationLayout
      organizationName={organization}
      organization={detail.data?.organization ?? null}
      heading="Repositories"
      activeTab="repositories"
      account={account}
    >
      <div className="repository-filter">
        <FormField id="repository-filter" label="Find a repository">
          <input
            id="repository-filter"
            name="filter"
            type="text"
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              applyFilter(event.target.value, visibility);
            }}
          />
        </FormField>
        <Combobox
          id="repository-visibility"
          label="Visibility"
          value={visibility}
          options={VISIBILITY_OPTIONS}
          onChange={(event) => {
            setVisibility(event.target.value);
            applyFilter(query, event.target.value);
          }}
        />
      </div>
      {detail.loading ? <p role="status">Loading repositories…</p> : null}
      {detail.error ? (
        <p className="form-error" role="alert">
          {detail.error}
        </p>
      ) : null}
      {detail.data ? (
        repositories.length > 0 ? (
          <ul className="repository-list">
            {repositories.map((repository) => (
              <li key={repository.name} className="repository-list__item">
                <a href={organizationUrl(organization, "repositories", repository.name)}>{repository.name}</a>
                <span className="repository-list__visibility" data-visibility={repository.visibility}>
                  {repository.visibility === "public" ? "Public" : "Private"}
                </span>
                <p className="repository-list__description">{repository.description}</p>
                <p className="repository-list__updated">Updated {formatUpdatedAt(repository.updatedAt)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p>No repositories matched this filter.</p>
        )
      ) : null}
    </OrganizationLayout>
  );
}
