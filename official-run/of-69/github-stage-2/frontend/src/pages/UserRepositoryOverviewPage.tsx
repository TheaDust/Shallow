import { RepositoryOverviewView } from "../components/RepositoryOverviewView";
import { fetchUserRepository } from "../lib/organization-api";

/**
 * Personal repository overview. The owner is an individual account, so the
 * heading names the repository as “username/repository name”; a private
 * personal repository is readable only by its owner and explicitly authorized
 * subjects.
 */
export function UserRepositoryOverviewPage({ username, repository }: { username: string; repository: string }) {
  return (
    <RepositoryOverviewView
      owner={{ type: "user", name: username }}
      repository={repository}
      load={(branch) => fetchUserRepository(username, repository, { branch })}
    />
  );
}
