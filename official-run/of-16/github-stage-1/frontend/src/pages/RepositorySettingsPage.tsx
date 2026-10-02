export interface RepositorySettingsPageProps {
  slug: string;
  name: string;
}

/**
 * Repository Settings shell. The repository overview links here; the page
 * exposes the section entries of the repository, of which "Manage access" is
 * the access-management page. Every entry is a real link, so it can be opened
 * and refreshed directly.
 */
export function RepositorySettingsPage({ slug, name }: RepositorySettingsPageProps) {
  const repositoryBase = `#/organizations/${slug}/repositories/${name}`;
  return (
    <section className="page page--narrow">
      <p className="repository-breadcrumb">
        <a className="repository-breadcrumb__repository" href={repositoryBase}>
          {name}
        </a>
      </p>
      <h1>Settings</h1>
      <nav className="settings-nav" aria-label="Repository settings">
        <ul className="settings-nav__list">
          <li>
            <a href={`${repositoryBase}/settings/manage-access`}>Manage access</a>
          </li>
        </ul>
      </nav>
    </section>
  );
}
