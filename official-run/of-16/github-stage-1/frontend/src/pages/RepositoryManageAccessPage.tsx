import { RepositoryManageAccess } from "../organizations/RepositoryManageAccess";

export interface RepositoryManageAccessPageProps {
  slug: string;
  name: string;
}

/**
 * "Manage access" page of a repository Settings area. The organization Owner or
 * a repository Admin maintains the access list here; the server decides that
 * authorization again for every read and write.
 */
export function RepositoryManageAccessPage({ slug, name }: RepositoryManageAccessPageProps) {
  const repositoryBase = `#/organizations/${slug}/repositories/${name}`;
  return (
    <section className="page">
      <p className="repository-breadcrumb">
        <a className="repository-breadcrumb__repository" href={repositoryBase}>
          {name}
        </a>
      </p>
      <h1>Manage access</h1>
      <RepositoryManageAccess slug={slug} name={name} />
    </section>
  );
}
