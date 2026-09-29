import { NotFoundPage } from "../common";
import { NewOrganizationPage } from "./NewOrganizationPage";
import { NewTeamPage } from "./NewTeamPage";
import { OrganizationPeoplePage } from "./OrganizationPeoplePage";
import { OrganizationRepositoriesPage } from "./OrganizationRepositoriesPage";
import { OrganizationTeamsPage } from "./OrganizationTeamsPage";
import { OrganizationsPage } from "./OrganizationsPage";
import { TeamPage } from "./TeamPage";

/**
 * Hash routes of the organization module:
 *
 *   #/organizations
 *   #/organizations/new
 *   #/organizations/:organization[/repositories|/people|/teams]
 *   #/organizations/:organization/teams/new
 *   #/organizations/:organization/teams/:team[/members|/settings]
 *
 * Repository addresses (`#/repositories/…`) are owned by the repository module
 * (`pages/repositories/RepositoryRoutes.tsx`).
 */
export function OrganizationRoutes({ segments }: { segments: readonly string[] }) {
  const [organizationName, section, third, fourth] = segments;

  if (!organizationName) return <OrganizationsPage />;
  if (organizationName === "new") return <NewOrganizationPage />;

  switch (section) {
    case undefined:
    case "repositories":
      return <OrganizationRepositoriesPage organizationName={organizationName} />;
    case "people":
      return <OrganizationPeoplePage organizationName={organizationName} />;
    case "teams":
      if (!third) return <OrganizationTeamsPage organizationName={organizationName} />;
      if (third === "new") return <NewTeamPage organizationName={organizationName} />;
      if (!fourth) return <TeamPage organizationName={organizationName} teamName={third} section="members" />;
      if (fourth === "members") {
        return <TeamPage organizationName={organizationName} teamName={third} section="members" />;
      }
      if (fourth === "settings") {
        return <TeamPage organizationName={organizationName} teamName={third} section="settings" />;
      }
      return <NotFoundPage />;
    default:
      return <NotFoundPage />;
  }
}
