import { sendJson } from "../lib/http.mjs";
import { findOrganization } from "../domain/organizations.mjs";
import {
  accountRepositories,
  findAccountOwner,
  repositorySummary,
  searchRepositories,
  visibleOrganizationRepositories,
} from "../domain/repository-access.mjs";

/**
 * Discovery surface for repositories (REQ-3-1): the global search that returns
 * the repositories the caller may view, and the namespace list a repository
 * address belongs to (an organization or an individual account).
 *
 * Search and every namespace list share one access rule: only repositories the
 * caller is authorized to read are ever returned, so a private repository is
 * invisible to a visitor through search, lists and the repository page alike.
 */

export function createDiscoveryApi({ store, resolveAccount }) {
  return async function handleDiscoveryRequest(request, response, { pathname, method, url }) {
    const segments = pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
    if (segments[0] !== "api") return false;

    if (segments[1] === "search" && segments[2] === "repositories" && segments.length === 3) {
      if (method !== "GET") {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      const account = await resolveAccount(request);
      const query = url.searchParams.get("q") ?? "";
      const data = await store.read();
      sendJson(response, 200, {
        query: query.trim(),
        repositories: searchRepositories(data, query, account?.id ?? null)
          .map((repository) => repositorySummary(data, repository)),
      });
      return true;
    }

    if (segments[1] === "namespaces" && segments.length === 3) {
      if (method !== "GET") {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      const account = await resolveAccount(request);
      const data = await store.read();
      const organization = findOrganization(data, segments[2]);
      if (organization) {
        sendJson(response, 200, {
          namespace: { type: "organization", name: organization.name, displayName: organization.displayName },
          repositories: visibleOrganizationRepositories(data, organization.id, account?.id ?? null)
            .map((repository) => repositorySummary(data, repository))
            .sort((left, right) => left.name.localeCompare(right.name)),
        });
        return true;
      }
      const owner = findAccountOwner(data, segments[2]);
      if (!owner) {
        sendJson(response, 404, { error: "Namespace not found" });
        return true;
      }
      sendJson(response, 200, {
        namespace: { type: "account", name: owner.username, displayName: owner.username },
        repositories: accountRepositories(data, owner.id, account?.id ?? null)
          .map((repository) => repositorySummary(data, repository))
          .sort((left, right) => left.name.localeCompare(right.name)),
      });
      return true;
    }

    return false;
  };
}
