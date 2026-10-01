import { RepositoryNav } from "../features/repositories/RepositoryNav";

export interface RepositorySettingsPageProps {
  owner: string;
  name: string;
}

/**
 * Repository settings (REQ-2-3, REQ-3-4, REQ-4-3-3): the page reached from the
 * repository's "Settings" link. Its "General" entry opens the Danger Zone that
 * changes the visibility, "Branches" opens the default-branch settings, and
 * "Manage access" opens the authorization management of the repository.
 */
export function RepositorySettingsPage({ owner, name }: RepositorySettingsPageProps) {
  return (
    <main className="repository-settings-page">
      <h1>Settings</h1>
      <p className="repository-settings-page__repository">
        <a href={`#/${owner}/${name}`}>{`${owner}/${name}`}</a>
      </p>
      <RepositoryNav owner={owner} name={name} active="settings" />
      <nav className="repository-settings-page__nav" aria-label="Repository settings">
        <a href={`#/${owner}/${name}/settings/general`}>General</a>
        <a href={`#/${owner}/${name}/settings/branches`}>Branches</a>
        <a href={`#/${owner}/${name}/settings/access`}>Manage access</a>
      </nav>
    </main>
  );
}
