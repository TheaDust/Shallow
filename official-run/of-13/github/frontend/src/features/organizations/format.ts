import type { OrganizationRole, RepositoryVisibility } from "../../lib/organizations-api";

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};

/** Human-readable update time for lists and overviews. */
export function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", DATE_FORMAT);
}

export function visibilityLabel(visibility: RepositoryVisibility): string {
  return visibility === "private" ? "Private" : "Public";
}

export function roleLabel(role: OrganizationRole): string {
  return role === "owner" ? "Owner" : "Member";
}
