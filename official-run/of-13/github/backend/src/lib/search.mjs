// Global search. Every result is filtered with the same access rule the
// repository pages use, so an unreadable private repository never appears in
// a result list even when its name matches the query.

import { canReadRepository, ownerNameOf } from "./access.mjs";

export const SEARCH_TYPES = ["repositories", "issues", "pullrequests"];

export const DEFAULT_SEARCH_TYPE = "repositories";

export function normalizeSearchType(type) {
  if (typeof type !== "string") return DEFAULT_SEARCH_TYPE;
  const value = type.trim().toLowerCase();
  return SEARCH_TYPES.includes(value) ? value : DEFAULT_SEARCH_TYPE;
}

function matches(text, term) {
  return typeof text === "string" && text.toLowerCase().includes(term);
}

export function createSearchService(store) {
  async function search(query, type, accountId) {
    const term = typeof query === "string" ? query.trim().toLowerCase() : "";
    const searchType = normalizeSearchType(type);
    const state = await store.read();

    // Issue and pull-request search land in later modules; an empty result set
    // is the honest answer until those records exist.
    if (searchType !== DEFAULT_SEARCH_TYPE || term.length === 0) {
      return { query: term, type: searchType, results: [] };
    }

    const results = (state.repositories ?? [])
      .filter((repository) => canReadRepository(state, repository, accountId))
      .filter(
        (repository) =>
          matches(repository.name, term) || matches(repository.description, term),
      )
      .map((repository) => ({
        owner: ownerNameOf(state, repository),
        name: repository.name,
        description: repository.description ?? "",
        visibility: repository.visibility,
        updatedAt: repository.updatedAt,
      }))
      .filter((result) => result.owner !== null)
      .sort((left, right) => left.name.localeCompare(right.name));

    return { query: term, type: searchType, results };
  }

  return { search };
}
