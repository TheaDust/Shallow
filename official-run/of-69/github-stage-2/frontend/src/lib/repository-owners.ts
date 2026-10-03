import type { MyOrganization } from "./organization-api";

/** A namespace a signed-in account may create a repository in. */
export interface OwnerOption {
  type: "user" | "organization";
  name: string;
  displayName: string;
}

/**
 * The creation/fork owner choices: the personal namespace first (so it is the
 * default target), then every organization the account owns. Membership alone
 * never makes an organization selectable, matching the server permission rule.
 */
export function buildOwnerOptions(username: string, organizations: MyOrganization[]): OwnerOption[] {
  return [
    { type: "user", name: username, displayName: username },
    ...organizations
      .filter((organization) => organization.role === "owner")
      .map((organization) => ({
        type: "organization" as const,
        name: organization.name,
        displayName: organization.displayName,
      })),
  ];
}
