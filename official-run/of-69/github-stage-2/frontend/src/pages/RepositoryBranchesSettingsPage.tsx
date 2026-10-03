import { useState, type FormEvent } from "react";

import { RepositoryLayout } from "../components/RepositoryLayout";
import { fetchRepository, updateDefaultBranch } from "../lib/organization-api";
import { organizationUrl, repositoryBranchesSettingsUrl } from "../lib/routes";
import { apiErrorMessage, useAsyncData } from "../lib/use-async-data";
import { useSession } from "../session/session-context";
import { Button, Dialog, FormField } from "../ui";

/**
 * Repository Settings → Branches. A repository Admin (or an organization Owner)
 * picks an existing branch in the native “Default branch” select, activates
 * “Update” and saves through the confirmation flow. Every other reader sees the
 * page without the combobox and without an update button; the server refuses
 * the change for them as well. The setting lives on the repository, so the
 * branches, commits and files it already had stay untouched.
 */
export function RepositoryBranchesSettingsPage({
  organization,
  repository,
}: {
  organization: string;
  repository: string;
}) {
  const { account } = useSession();
  const detail = useAsyncData(() => fetchRepository(organization, repository), [organization, repository]);
  const loaded = detail.data;
  const canManage = loaded?.viewer.canManage ?? false;
  const branchNames = (loaded?.branches ?? []).map((branch) => branch.name);
  const defaultBranch = loaded?.repository.defaultBranch ?? "";
  const [choice, setChoice] = useState<string | null>(null);
  const selected = choice ?? defaultBranch;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateDefaultBranch(organization, repository, selected);
      setDialogOpen(false);
      setChoice(null);
      setSaved(true);
      detail.reload();
    } catch (caught) {
      setError(apiErrorMessage(caught, "Unable to save the branch setting."));
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
            <a href={organizationUrl(organization, "repositories", repository, "settings")}>General</a>
            <a href={repositoryBranchesSettingsUrl(organization, repository)} aria-current="page">
              Branches
            </a>
          </nav>
          <section className="settings-section" aria-labelledby="repository-branches-heading">
            <h2 id="repository-branches-heading">Branches</h2>
            {canManage ? (
              <>
                <p className="page-hint">Choose the branch this repository reads first.</p>
                <FormField id="default-branch" label="Default branch">
                  <select
                    id="default-branch"
                    value={selected}
                    onChange={(event) => {
                      setChoice(event.target.value);
                      setSaved(false);
                    }}
                  >
                    {branchNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </FormField>
                <Button variant="primary" onClick={() => setDialogOpen(true)}>
                  Update
                </Button>
                {saved ? (
                  <p role="status" className="settings-saved">
                    Saved
                  </p>
                ) : null}
              </>
            ) : (
              <p className="page-hint">
                You do not have permission to change the branch this repository reads first.
              </p>
            )}
          </section>
        </>
      ) : null}
      {dialogOpen ? (
        <Dialog
          open
          title="Update the branch this repository reads first"
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setError(null);
          }}
        >
          <form className="auth-form" noValidate onSubmit={handleConfirm}>
            <p>{`Readers will open ${selected} when they visit this repository.`}</p>
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
                Confirm
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </RepositoryLayout>
  );
}
