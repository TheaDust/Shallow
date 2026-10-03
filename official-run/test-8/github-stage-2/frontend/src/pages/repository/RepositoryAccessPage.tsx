import { useAuth } from "../../auth/AuthProvider";
import { SiteHeader } from "../../components/SiteHeader";
import { makeHash } from "../../lib/hash-route";
import { RepositoryAccessPanel } from "./RepositoryAccessPanel";

/** Repository “Settings → Manage access”. */
export function RepositoryAccessPage({ slug, repositoryName }: { slug: string; repositoryName: string }) {
  const { account } = useAuth();

  return (
    <main>
      <SiteHeader account={account} />
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <a className="breadcrumb__link" href={makeHash(`/repositories/${slug}/${repositoryName}/settings`)}>
          Settings
        </a>
      </nav>
      <h1>Manage access</h1>
      <RepositoryAccessPanel slug={slug} repositoryName={repositoryName} />
    </main>
  );
}
