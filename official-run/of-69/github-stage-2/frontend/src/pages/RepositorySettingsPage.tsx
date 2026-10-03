import { useState, type FormEvent } from "react";

import { RepositoryLayout } from "../components/RepositoryLayout";
import { fetchRepository, updateRepositoryVisibility } from "../lib/organization-api";
import { navigate } from "../lib/hash-route";
import { organizationPath, organizationUrl, repositoryBranchesSettingsUrl } from "../lib/routes";
import { apiErrorMessage, useAsyncData } from "../lib/use-async-data";
import { useSession } from "../session/session-context";
import { Button, Dialog } from "../ui";

type Visibility = "public" | "private";

/**
 * Repository Settings, General section. A repository Admin can change the
 * visibility through the confirmation flow; the server repeats the permission
 * check, so a non-Admin caller never changes anything even if the button were
 * reachable. After a successful change the repository overview is opened, where
 * the new Public/Private marker is visible.
 */
export function RepositorySettingsPage({ organization, repository }: { organization: string; repository: string }) {
  const { account } = useSession();
  const detail = useAsyncData(() => fetchRepository(organization, repository), [organization, repository]);
  const loaded = detail.data;
  const canManage = loaded?.viewer.canManage ?? false;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<Visibility>("private");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function openDialog() {
    setSelected(loaded?.repository.visibility ?? "private");
    setError(null);
    setDialogOpen(true);
  }

  async function handleConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateRepositoryVisibility(organization, repository, selected);
      setDialogOpen(false);
      navigate(organizationPath(organization, "repositories", repository));
    } catch (caught) {
      setError(apiErrorMessage(caught, "Unable to change the visibility."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <RepositoryLayout
      owner={{ type: "organization", name: organization, displayName: loaded?.organization.displayName }}
      repositoryName={repository}
      activeSection="settings"
      canManage={canManage}
      account={account}
      heading="Settings"
    >
      {detail.loading ? <p role="status">Loading settings…</p> : null}
      {detail.error ? (
        <p className="form-error" role="alert">
          {detail.error}
        </p>
      ) : null}
      {loaded ? (
        <>
          <nav className="settings-nav" aria-label="Repository settings">
            <a
              href={organizationUrl(organization, "repositories", repository, "settings")}
              aria-current="page"
            >
              General
            </a>
            <a href={repositoryBranchesSettingsUrl(organization, repository)}>Branches</a>
          </nav>
          <section className="settings-section" aria-labelledby="repository-visibility-heading">
            <h2 id="repository-visibility-heading">Repository visibility</h2>
            <p className="page-hint">Choose who can read this repository.</p>
            {canManage ? (
              <Button variant="primary" onClick={openDialog}>
                Change visibility
              </Button>
            ) : null}
          </section>
        </>
      ) : null}
      {dialogOpen ? (
        <Dialog
          open
          title="Change visibility"
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setError(null);
          }}
        >
          <form className="auth-form" noValidate onSubmit={handleConfirm}>
            <fieldset className="access-picker">
              <legend>Visibility</legend>
              <label className="access-picker__option">
                <input
                  type="radio"
                  name="visibility"
                  value="public"
                  checked={selected === "public"}
                  onChange={() => setSelected("public")}
                />
                Public
              </label>
              <label className="access-picker__option">
                <input
                  type="radio"
                  name="visibility"
                  value="private"
                  checked={selected === "private"}
                  onChange={() => setSelected("private")}
                />
                Private
              </label>
            </fieldset>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="dialog-actions">
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                Confirm visibility
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </RepositoryLayout>
  );
}
