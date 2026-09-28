import { useEffect, useRef, useState } from "react";

import { AppHeader } from "../../components/AppHeader";
import { changeDefaultBranch, repoOwnerBase, RepoOwnerType } from "../../lib/repo-api";
import { useSession } from "../../session";
import { useRepoDetail } from "./useRepoDetail";
import { ProtectionRulesSection } from "./ProtectionRulesSection";

interface RepoBranchesSettingsProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
  showManageAccess: boolean;
}

/**
 * Repository Settings → Branches page (REQ-4-3-3). The repository Admin (or
 * organization Owner) sees the native “Default branch” select whose options
 * are the exact existing branch names, the “Update” button, and the
 * confirmation dialog with “Confirm”. A non-Admin sees only the current
 * default branch as text — no combobox and no update button are rendered.
 * Changing the default branch never deletes or rewrites the previous branch.
 */
export function RepoBranchesSettings({
  ownerType,
  ownerName,
  repoName,
  showManageAccess,
}: RepoBranchesSettingsProps) {
  const { status } = useSession();
  const { status: detailStatus, repository, refresh } = useRepoDetail(ownerType, ownerName, repoName);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    if (dialogOpen) {
      page.setAttribute("inert", "");
    } else {
      page.removeAttribute("inert");
    }
  }, [dialogOpen]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setDialogOpen(false);
    }
    if (dialogOpen) window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialogOpen]);

  useEffect(() => {
    if (repository) setSelectedBranch(repository.defaultBranch);
  }, [repository]);

  const base = `${repoOwnerBase(ownerType, ownerName)}/repos/${encodeURIComponent(repoName)}`;

  if (detailStatus === "notfound") {
    return (
      <AppHeader>
        <main>
          <h1>{ownerName}/{repoName}</h1>
          <p>Repository not found.</p>
        </main>
      </AppHeader>
    );
  }

  if (detailStatus === "denied") {
    return (
      <AppHeader>
        <main>
          <h1>{ownerName}/{repoName}</h1>
          <p>Access denied</p>
          {status !== "authenticated" && (
            <p>
              <a href="#/signin">Sign in</a>
            </p>
          )}
        </main>
      </AppHeader>
    );
  }

  if (detailStatus !== "ready" || !repository) {
    return (
      <AppHeader>
        <main>
          <h1>{ownerName}/{repoName}</h1>
          <p>Loading…</p>
        </main>
      </AppHeader>
    );
  }

  const name = repository.name || repoName;
  const isAdmin = repository.currentRole === "admin";

  async function confirmChange() {
    if (submitting) return;
    setSubmitting(true);
    setSaved(false);
    setError(null);
    try {
      await changeDefaultBranch(ownerType, ownerName, name, selectedBranch);
      await refresh();
      setDialogOpen(false);
      setSaved(true);
    } catch {
      setDialogOpen(false);
      setError("Could not update the default branch");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div ref={pageRef}>
        <AppHeader>
          <main>
            <h1>{ownerName}/{name}</h1>
            <nav className="org-tabs" aria-label="Repository">
              <a className="org-tabs__link" href={`#${base}`}>
                Code
              </a>
              <a className="org-tabs__link" href={`#${base}/settings`} aria-current="page">
                Settings
              </a>
            </nav>
            <nav className="org-tabs" aria-label="Settings">
              <a className="org-tabs__link" href={`#${base}/settings`}>
                General
              </a>
              <a className="org-tabs__link" href={`#${base}/settings/branches`} aria-current="page">
                Branches
              </a>
              {showManageAccess && (
                <a className="org-tabs__link" href={`#${base}/settings/access`}>
                  Manage access
                </a>
              )}
            </nav>
            <section className="settings-section" aria-label="Default branch">
              <h2>Default branch</h2>
              <p>
                Choosing a new default branch changes the branch shown when the repository is opened
                without a specific branch.
              </p>
              {isAdmin ? (
                <div className="default-branch-form">
                  <label className="account-form__label" htmlFor="default-branch">
                    Default branch
                  </label>
                  <select
                    id="default-branch"
                    name="default-branch"
                    className="default-branch-form__select"
                    value={selectedBranch}
                    onChange={(event) => {
                      setSelectedBranch(event.target.value);
                      setSaved(false);
                    }}
                  >
                    {repository.branches.map((branch) => (
                      <option key={branch.name} value={branch.name}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="button"
                    onClick={() => setDialogOpen(true)}
                  >
                    Update
                  </button>
                </div>
              ) : (
                <>
                  <p>
                    Default branch:{" "}
                    <span className="repo-overview__branch">{repository.defaultBranch}</span>
                  </p>
                  <p className="danger-zone__note">Only repository Admins can change the default branch.</p>
                </>
              )}
              {saved && <p className="account-form__status">Default branch updated</p>}
              {error && (
                <p role="alert" className="branch-selector__error">
                  {error}
                </p>
              )}
            </section>
            <ProtectionRulesSection
              ownerType={ownerType}
              ownerName={ownerName}
              repoName={repoName}
              repository={repository}
            />
          </main>
        </AppHeader>
      </div>
      {dialogOpen && (
        <div className="change-visibility-dialog" role="dialog" aria-label="Change default branch">
          <h2>Change default branch</h2>
          <p>
            Change the default branch of {ownerName}/{name} from {repository.defaultBranch} to{" "}
            {selectedBranch}?
          </p>
          <div className="sign-out-dialog__actions">
            <button
              type="button"
              className="button button--primary"
              disabled={submitting}
              onClick={() => void confirmChange()}
            >
              Confirm
            </button>
            <button type="button" className="button" onClick={() => setDialogOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
