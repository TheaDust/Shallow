import { useState } from "react";

import {
  fetchRepository,
  setRepositoryVisibility,
  type RepositoryVisibility,
} from "../../api/organizations";
import { useAuth } from "../../auth/AuthProvider";
import { RepositorySettingsNav } from "../../components/RepositorySettingsNav";
import { SiteHeader } from "../../components/SiteHeader";
import { makeHash, navigate } from "../../lib/hash-route";
import { useAsyncData } from "../../lib/useAsyncData";
import { Button, Dialog } from "../../ui";

const VISIBILITY_LABEL: Record<RepositoryVisibility, string> = { public: "Public", private: "Private" };
const VISIBILITIES: RepositoryVisibility[] = ["public", "private"];

interface ChangeVisibilityDialogProps {
  current: RepositoryVisibility;
  onDismiss(): void;
  onConfirm(visibility: RepositoryVisibility): Promise<string | null>;
}

/**
 * The visibility confirmation step. The dialog is mounted only while it is open,
 * so every visit starts from the stored visibility, and the confirmation button
 * stays disabled while the change is in flight.
 */
function ChangeVisibilityDialog({ current, onDismiss, onConfirm }: ChangeVisibilityDialogProps) {
  const [choice, setChoice] = useState<RepositoryVisibility>(current);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const confirm = async () => {
    setPending(true);
    setFailure(null);
    const message = await onConfirm(choice);
    setPending(false);
    if (message) setFailure(message);
  };

  return (
    <Dialog
      open
      title="Change repository visibility"
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
      actions={
        <>
          <Button onClick={onDismiss}>Cancel</Button>
          <Button variant="primary" disabled={pending} onClick={() => void confirm()}>
            Confirm visibility
          </Button>
        </>
      }
    >
      <fieldset className="visibility-options">
        <legend>Repository visibility</legend>
        {VISIBILITIES.map((visibility) => (
          <div key={visibility} className="visibility-option">
            <input
              id={`visibility-${visibility}`}
              type="radio"
              name="visibility"
              value={visibility}
              checked={choice === visibility}
              onChange={() => setChoice(visibility)}
            />
            <label htmlFor={`visibility-${visibility}`}>{VISIBILITY_LABEL[visibility]}</label>
          </div>
        ))}
      </fieldset>
      {failure ? (
        <p className="form-error" role="alert">
          {failure}
        </p>
      ) : null}
    </Dialog>
  );
}

/**
 * Repository “Settings”. The General entry carries the visibility flow for a
 * repository Admin; “Manage access” continues to the access rows. A viewer who
 * is not an Admin sees neither entry nor an actionable “Change visibility”
 * button, and the server refuses the change anyway.
 */
export function RepositorySettingsPage({ slug, repositoryName }: { slug: string; repositoryName: string }) {
  const { account } = useAuth();
  const { data, error, loading } = useAsyncData(() => fetchRepository(slug, repositoryName), [slug, repositoryName]);
  const repository = data?.repository ?? null;
  const organizationName = repository?.owner?.displayName ?? slug;
  const isAdmin = repository?.role === "admin";
  const [visibilityOpen, setVisibilityOpen] = useState(false);

  const confirmVisibility = async (visibility: RepositoryVisibility): Promise<string | null> => {
    try {
      await setRepositoryVisibility(slug, repositoryName, visibility);
    } catch (failure) {
      return failure instanceof Error ? failure.message : "Visibility update failed";
    }
    setVisibilityOpen(false);
    // The overview is where the new marker (and the search/list visibility) is
    // read, so the confirmation lands there.
    navigate(`/repositories/${slug}/${repositoryName}`);
    return null;
  };

  return (
    <main>
      <SiteHeader account={account} />
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <a className="breadcrumb__link" href={makeHash(`/repositories/${slug}/${repositoryName}`)}>
          {repository ? `${organizationName}/${repository.name}` : repositoryName}
        </a>
      </nav>
      <h1>Settings</h1>
      {loading ? <p role="status">Loading…</p> : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {repository && !error ? (
        <>
          <RepositorySettingsNav
            ownerLogin={slug}
            repositoryName={repository.name}
            isAdmin={isAdmin}
            active="general"
          />
          <section className="settings-section" aria-label="Visibility">
            <p className="settings-note">
              {`This repository is currently ${VISIBILITY_LABEL[repository.visibility]}.`}
            </p>
            {isAdmin ? (
              <Button variant="primary" onClick={() => setVisibilityOpen(true)}>
                Change visibility
              </Button>
            ) : null}
          </section>
          {isAdmin && visibilityOpen ? (
            <ChangeVisibilityDialog
              current={repository.visibility}
              onDismiss={() => setVisibilityOpen(false)}
              onConfirm={confirmVisibility}
            />
          ) : null}
        </>
      ) : null}
    </main>
  );
}
