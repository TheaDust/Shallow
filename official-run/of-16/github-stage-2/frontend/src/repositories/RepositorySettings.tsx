import { useEffect, useState } from "react";

import { ApiError } from "../lib/api";
import { visibilityLabel } from "../organizations/format";
import type { RepositoryVisibility } from "../organizations/types";
import { Button, Dialog } from "../ui";
import { changeRepositoryVisibility, fetchRepositoryView } from "./api";
import { RepositoryBranchesSettings } from "./RepositoryBranchesSettings";
import { repositoryPath } from "./routes";
import type { RepositoryOwnerKind, RepositoryView } from "./types";

export interface RepositorySettingsProps {
  ownerKind: RepositoryOwnerKind;
  owner: string;
  name: string;
  /** Stored section of the address: "general", "manage-access" or none. */
  section?: string;
}

const LOAD_ERROR = "We could not load this repository. Try again.";
const CHANGE_ERROR = "We could not change the visibility. Try again.";

/**
 * Settings area of one repository, organization or personal. The nav always
 * renders the "General" entry (plus "Manage access" for organization
 * repositories and "Branches" for the administrator) and every entry is a real
 * link, so a section can be opened and refreshed directly. The General panel
 * shows the stored visibility marker and offers "Change visibility" only to the
 * repository administrator; the change itself is confirmed in the "Change
 * visibility" dialog through the "Public" or "Private" radio and the "Confirm
 * visibility" button. The Branches panel offers the "Default branch" select and
 * the "Update" confirmation flow to the administrator only. A viewer who does
 * not administer the repository never gets an actionable control, and the server
 * decides the same permission again.
 */
export function RepositorySettings({ ownerKind, owner, name, section }: RepositorySettingsProps) {
  const [repository, setRepository] = useState<RepositoryView | null>(null);
  const [failure, setFailure] = useState<"denied" | "notFound" | "failed" | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<RepositoryVisibility>("private");
  const [busy, setBusy] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRepository(null);
    setFailure(null);
    setDialogOpen(false);
    setChangeError(null);
    setStatus(null);
    fetchRepositoryView(ownerKind, owner, name)
      .then((next) => {
        if (!cancelled) setRepository(next);
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) setFailure("denied");
        else if (error instanceof ApiError && error.status === 404) setFailure("notFound");
        else setFailure("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [ownerKind, owner, name]);

  // The visibility dialog belongs to the General section only.
  useEffect(() => {
    setDialogOpen(false);
  }, [section]);

  const repositoryBase = `#${repositoryPath(ownerKind, owner, name)}`;
  const settingsBase = `${repositoryBase}/settings`;
  const canManage = repository?.canManage === true;
  const activeSection = section ?? "general";

  function openVisibilityDialog() {
    setDraft(repository?.visibility ?? "private");
    setChangeError(null);
    setStatus(null);
    setDialogOpen(true);
  }

  async function confirmVisibility() {
    if (busy || !repository) return;
    setBusy(true);
    setChangeError(null);
    try {
      const next = await changeRepositoryVisibility(ownerKind, owner, name, draft);
      setRepository(next);
      setDialogOpen(false);
      setStatus("Visibility updated.");
    } catch (error) {
      setChangeError(error instanceof ApiError ? error.message : CHANGE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  if (failure === "notFound") {
    return (
      <section className="page page--narrow">
        <h1>Repository not found</h1>
        <p className="page__lead">The address does not match a repository visible to you.</p>
      </section>
    );
  }

  if (failure === "denied") {
    return (
      <section className="page page--narrow">
        <h1>Access denied</h1>
        <p className="page__lead">Your account cannot read this private repository.</p>
      </section>
    );
  }

  if (failure === "failed") {
    return (
      <section className="page page--narrow">
        <p role="alert">{LOAD_ERROR}</p>
      </section>
    );
  }

  return (
    <section className="page">
      <p className="repository-breadcrumb">
        <a className="repository-breadcrumb__repository" href={repositoryBase}>
          {name}
        </a>
      </p>
      <h1>Settings</h1>
      <nav className="settings-nav" aria-label="Repository settings">
        <ul className="settings-nav__list">
          <li>
            <a
              className="settings-nav__entry"
              href={`${settingsBase}/general`}
              aria-current={activeSection === "general" ? "page" : undefined}
            >
              General
            </a>
          </li>
          {canManage ? (
            <li>
              <a
                className="settings-nav__entry"
                href={`${settingsBase}/branches`}
                aria-current={activeSection === "branches" ? "page" : undefined}
              >
                Branches
              </a>
            </li>
          ) : null}
          {ownerKind === "organization" ? (
            <li>
              <a
                className="settings-nav__entry"
                href={`${settingsBase}/manage-access`}
                aria-current={activeSection === "manage-access" ? "page" : undefined}
              >
                Manage access
              </a>
            </li>
          ) : null}
        </ul>
      </nav>
      {activeSection === "branches" ? (
        !repository ? (
          <section className="repository-settings__section" aria-label="Branches">
            <p role="status">Loading repository…</p>
          </section>
        ) : canManage ? (
          <RepositoryBranchesSettings
            ownerKind={ownerKind}
            owner={owner}
            name={name}
            repository={repository}
            onUpdated={setRepository}
          />
        ) : (
          <section className="repository-settings__section" aria-label="Branches">
            <p className="page__lead">
              <span role="alert">Access denied</span>
            </p>
          </section>
        )
      ) : (
        <section className="repository-settings__section" aria-label="General">
          {!repository ? (
            <p role="status">Loading repository…</p>
          ) : !canManage ? (
            <p className="page__lead">
              <span role="alert">Access denied</span>
            </p>
          ) : (
            <>
              <p className="repository-settings__visibility-row">
                <span className="repository-settings__label">Visibility</span>{" "}
                <span className="repository-settings__visibility">{visibilityLabel(repository.visibility)}</span>
              </p>
              <p className="repository-settings__description">
                Choose who can see this repository and its code.
              </p>
              {status ? <p role="status">{status}</p> : null}
              <div className="app-form__actions">
                <Button variant="secondary" onClick={openVisibilityDialog}>
                  Change visibility
                </Button>
              </div>
            </>
          )}
        </section>
      )}
      {dialogOpen ? (
        <Dialog
          open
          title="Change visibility"
          description="Choose the new visibility of this repository. This takes effect immediately."
          showClose={false}
          onOpenChange={(open) => {
            if (!open) setDialogOpen(false);
          }}
          actions={
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={busy}
                aria-busy={busy}
                onClick={() => {
                  void confirmVisibility();
                }}
              >
                Confirm visibility
              </Button>
            </>
          }
        >
          <fieldset className="visibility-options">
            <legend>Visibility</legend>
            <label className="visibility-options__option" htmlFor="visibility-public">
              <input
                id="visibility-public"
                type="radio"
                name="repository-visibility"
                value="public"
                checked={draft === "public"}
                onChange={() => setDraft("public")}
              />{" "}
              Public
            </label>
            <label className="visibility-options__option" htmlFor="visibility-private">
              <input
                id="visibility-private"
                type="radio"
                name="repository-visibility"
                value="private"
                checked={draft === "private"}
                onChange={() => setDraft("private")}
              />{" "}
              Private
            </label>
          </fieldset>
          {changeError ? (
            <p className="app-form__error" role="alert">
              {changeError}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </section>
  );
}
