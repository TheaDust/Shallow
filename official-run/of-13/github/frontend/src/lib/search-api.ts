import { apiRequest } from "./api";
import type { RepositoryVisibility } from "./organizations-api";

/** Result types the results page offers a filter for. */
export type SearchType = "repositories" | "issues" | "pullrequests";

export const DEFAULT_SEARCH_TYPE: SearchType = "repositories";

export const SEARCH_TYPE_OPTIONS: ReadonlyArray<{ type: SearchType; label: string }> = [
  { type: "repositories", label: "Repositories" },
  { type: "issues", label: "Issues" },
  { type: "pullrequests", label: "Pull requests" },
];

export function normalizeSearchType(value: string | null | undefined): SearchType {
  const match = SEARCH_TYPE_OPTIONS.find((option) => option.type === value);
  return match?.type ?? DEFAULT_SEARCH_TYPE;
}

export interface RepositorySearchResult {
  owner: string;
  name: string;
  description: string;
  visibility: RepositoryVisibility;
  updatedAt: string;
}

export interface SearchResponse {
  query: string;
  type: SearchType;
  results: RepositorySearchResult[];
}

export async function searchRepositories(
  query: string,
  type: SearchType,
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query, type });
  return apiRequest<SearchResponse>(`/api/search?${params.toString()}`);
}

/** Hash address of the global results page for a query and result type. */
export function searchHref(query: string, type: SearchType): string {
  const params = new URLSearchParams({ q: query, type });
  return `#/search?${params.toString()}`;
}
