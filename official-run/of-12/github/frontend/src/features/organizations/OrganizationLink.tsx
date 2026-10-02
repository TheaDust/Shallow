import type { OrganizationSummary } from "./org-api";

export interface OrganizationLinkProps {
  organization: Pick<OrganizationSummary, "name" | "displayName">;
  className?: string;
}

/**
 * Navigation entry into an organization overview (REQ-2-1).
 *
 * The organization's display name and its identifier are separate links to the
 * same identifier-scoped page, so the entry can be opened by either of the two
 * values the organization is known by (the seed organization `Acme Demo` /
 * `acme-demo`).
 */
export function OrganizationLink({ organization, className }: OrganizationLinkProps) {
  const href = `#/organizations/${organization.name}`;
  return (
    <>
      <a className={["organization-link", className].filter(Boolean).join(" ")} href={href}>
        <span className="organization-link__display">{organization.displayName}</span>
      </a>
      <a
        className={["organization-link__slug", className].filter(Boolean).join(" ")}
        href={href}
      >
        {organization.name}
      </a>
    </>
  );
}
