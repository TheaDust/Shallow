import { useEffect, useRef, useState } from "react";

import { AppHeader } from "../../components/AppHeader";
import { changeRepositoryVisibility, repoOwnerBase, RepoOwnerType } from "../../lib/repo-api";
import { useSession } from "../../session";
import { useRepoDetail } from "./useRepoDetail";

interface RepoSettingsViewProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
  showManageAccess: boolean;
}

/**
 * Repository Settings page: the “General” entry leads to the Danger Zone with
 * the “Change visibility” action. Only the repository Admin sees the action
 * button; the confirmation dialog offers a “Public” radio and the “Confirm
 * visibility” button, without any additional mandatory field.
 */
export function RepoSettingsView({ ownerType, ownerName, repoName, showManageAccess }: RepoSettingsViewProps) {
  const { status } = useSession();
  const { status: detailStatus, repository, refresh } = useRepoDetail(ownerType, ownerName, repoName);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<"public" | "private">("private");
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
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
    if (repository) setSelected(repository.visibility);
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
  const visibility = repository.visibility === "public" ? "public" : "private";

  async function confirmVisibility() {
    if (submitting) return;
    setSubmitting(true);
    setSaved(false);
    try {
      await changeRepositoryVisibility(ownerType, ownerName, name, selected);
      await refresh();
      setDialogOpen(false);
      setSaved(true);
    } catch {
      setDialogOpen(false);
      setSaved(false);
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
              <a className="org-tabs__link" href={`#${base}/settings`} aria-current="page">
                General
              </a>
              <a className="org-tabs__link" href={`#${base}/settings/branches`}>
                Branches
              </a>
              {showManageAccess && (
                <a className="org-tabs__link" href={`#${base}/settings/access`}>
                  Manage access
                </a>
              )}
            </nav>
            <section aria-label="General">
              <h2>General</h2>
              <p>
                Visibility: <span className="repo-list__visibility">{visibility === "public" ? "Public" : "Private"}</span>
              </p>
              {saved && <p className="account-form__status">Visibility updated</p>}
            </section>
            <section aria-label="Danger Zone" className="settings-section danger-zone">
              <h2>Danger Zone</h2>
              <p>Changing visibility affects who can read this repository.</p>
              {isAdmin ? (
                <button type="button" className="button" onClick={() => setDialogOpen(true)}>
                  Change visibility
                </button>
              ) : (
                <p className="danger-zone__note">Only repository Admins can change visibility.</p>
              )}
            </section>
          </main>
        </AppHeader>
      </div>
      {dialogOpen && (
        <div className="change-visibility-dialog" role="dialog" aria-label="Change visibility">
          <h2>Change visibility</h2>
          <p>
            Choose the new visibility for {ownerName}/{name}.
          </p>
          <fieldset className="account-form__field">
            <legend>Visibility</legend>
            <label className="account-form__checkbox">
              <input
                type="radio"
                name="change-visibility"
                value="private"
                checked={selected === "private"}
                onChange={() => setSelected("private")}
              />
              Private
            </label>
            <label className="account-form__checkbox">
              <input
                type="radio"
                name="change-visibility"
                value="public"
                checked={selected === "public"}
                onChange={() => setSelected("public")}
              />
              Public
            </label>
          </fieldset>
          <div className="sign-out-dialog__actions">
            <button
              type="button"
              className="button button--primary"
              disabled={submitting}
              onClick={() => void confirmVisibility()}
            >
              Confirm visibility
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
