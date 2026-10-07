// Namespace selection shared by the repository-creation and fork forms.
//
// A repository owner is either the signed-in account's personal namespace or an
// organization the account may create repositories in (an organization Owner).
// The combobox value encodes both parts so the same control can submit either.

import type { OrganizationSummary } from "./org-api";

export interface NamespaceOption {
  value: string;
  label: string;
}

export function namespaceOptions(
  user: { id: string; username: string },
  organizations: readonly OrganizationSummary[],
): NamespaceOption[] {
  return [
    { value: `account:${user.id}`, label: user.username },
    ...organizations
      .filter((organization) => organization.role === "Owner")
      .map((organization) => ({ value: `organization:${organization.id}`, label: organization.displayName })),
  ];
}

export function parseNamespace(value: string): {
  ownerType: "account" | "organization";
  ownerId: string;
} {
  const separator = value.indexOf(":");
  const type = separator === -1 ? "" : value.slice(0, separator);
  const ownerId = separator === -1 ? value : value.slice(separator + 1);
  return { ownerType: type === "organization" ? "organization" : "account", ownerId };
}
