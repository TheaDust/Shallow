import { RepositoryOverviewView } from "../components/RepositoryOverviewView";
import { fetchRepository } from "../lib/organization-api";

/**
 * Organization repository overview. The heading names the repository as
 * “organization display name/repository name” with the identifier form next to
 * it; a repository the viewer may not read answers “Access denied” instead of
 * exposing any of its content.
 */
export function RepositoryOverviewPage({ organization, repository }: { organization: string; repository: string }) {
  return (
    <RepositoryOverviewView
      owner={{ type: "organization", name: organization }}
      repository={repository}
      load={async (branch) => {
        const detail = await fetchRepository(organization, repository, { branch });
        return {
          ...detail,
          owner: {
            type: "organization",
            name: organization,
            displayName: detail.organization.displayName,
          },
        };
      }}
    />
  );
}
