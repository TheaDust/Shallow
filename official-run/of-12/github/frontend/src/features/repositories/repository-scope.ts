/**
 * The repository a page address belongs to (REQ-4-2-3).
 *
 * The global searchbox is rendered once per page and stays the single control
 * named "Search". On a repository address it searches the code of that
 * repository, so the scope is read back from the address itself instead of
 * being duplicated in the header.
 */

/** Top-level addresses that never carry a repository scope. */
const RESERVED = new Set([
  "search",
  "settings",
  "new",
  "workspace",
  "organizations",
  "orgs",
  "sign-in",
  "register",
  "forgot-password",
]);

/** The Code page family below a repository address. */
const REPOSITORY_SECTIONS = new Set([
  "code",
  "blob",
  "tree",
  "edit",
  "new",
  "commits",
  "commit",
  "compare",
  "issues",
  "pulls",
  "fork",
  "settings",
]);

export interface RepositoryScope {
  owner: string;
  name: string;
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The repository an address such as `/<owner>/<name>/commits` belongs to. */
export function repositoryScopeFromPath(path: string): RepositoryScope | null {
  const segments = path.split("/").filter(Boolean).map(decode);
  if (segments.length < 2) return null;
  if (RESERVED.has(segments[0])) return null;
  if (segments.length === 2) return { owner: segments[0], name: segments[1] };
  if (REPOSITORY_SECTIONS.has(segments[2])) return { owner: segments[0], name: segments[1] };
  return null;
}
