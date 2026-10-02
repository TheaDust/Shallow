/** Human-readable update time of a repository list entry. */
export function formatUpdatedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function visibilityLabel(visibility: string): string {
  return visibility === "private" ? "Private" : "Public";
}

/** Visible label of an organization membership role. */
export function organizationRoleLabel(role: string): string {
  return role === "owner" ? "Owner" : "Member";
}

const REPOSITORY_ROLE_LABELS: Record<string, string> = {
  read: "Read",
  triage: "Triage",
  write: "Write",
  maintain: "Maintain",
  admin: "Admin",
};

/** Visible label of a repository role; unknown values read as the least role. */
export function repositoryRoleLabel(role: string): string {
  return REPOSITORY_ROLE_LABELS[role] ?? "Read";
}

const ROLE_KEYS = Object.keys(REPOSITORY_ROLE_LABELS);

/**
 * Inverse of {@link repositoryRoleLabel}: maps a visible role label back to the
 * stored role value. The "Role" comboboxes use the label as the option value so
 * the control exposes the exact requirement wording ("Write", "Read", ...);
 * requests to the API still carry the stored lowercase role.
 */
export function repositoryRoleFromLabel(label: string): string {
  const match = ROLE_KEYS.find((key) => REPOSITORY_ROLE_LABELS[key] === label);
  return match ?? "read";
}
