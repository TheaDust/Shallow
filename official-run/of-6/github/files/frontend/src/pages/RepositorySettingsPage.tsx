import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { apiRepository, apiUpdateRepositoryVisibility } from '../api';
import { navigate } from '../router';
import { useSession } from '../session';
import type { RepositoryOverview } from '../types';

interface RepositorySettingsPageProps {
  owner: string;
  name: string;
}

type Visibility = 'public' | 'private';

function visibilityLabel(visibility: Visibility): string {
  return visibility === 'public' ? 'Public' : 'Private';
}

/**
 * REQ-3-4: the repository Settings page is the "General" tab of repository
 * settings. Only an organization Owner or repository Admin may open it (the
 * page itself shows the same Access denied state to anyone else, so a
 * non-Admin collaborator never sees the "Change visibility" button even when
 * a Settings link would be available). The page provides the "General" and
 * "Manage access" navigation entries and, on the General tab, the Danger
 * Zone with the "Change visibility" button. The confirmation dialog offers
 * the "Public"/"Private" radios and the "Confirm visibility" button; a
 * confirmation text that does not match the repository name is rejected and
 * the visibility stays unchanged. The selected visibility is persisted by
 * the server, so refreshing the page keeps the result.
 */
export default function RepositorySettingsPage({ owner, name }: RepositorySettingsPageProps) {
  const { auth } = useSession();
  const [repository, setRepository] = useState<RepositoryOverview | null>(null);
  const [denied, setDenied] = useState(false);
  const [notFound, setNotFound] = useState(false);

  // Visibility-change dialog state.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [targetVisibility, setTargetVisibility] = useState<Visibility>('public');
  const [confirmation, setConfirmation] = useState('');
  const [changeError, setChangeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const changeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmationInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setRepository(null);
    setDenied(false);
    setNotFound(false);
    setDialogOpen(false);
    setChangeError(null);
    apiRepository(owner, name).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setRepository(result.repository);
      } else if (result.status === 403) {
        setDenied(true);
      } else {
        setNotFound(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [owner, name]);

  // Focus the confirmation input when the dialog opens; restore focus to the
  // Change visibility button when it closes.
  useEffect(() => {
    if (dialogOpen) {
      confirmationInputRef.current?.focus();
    } else {
      changeButtonRef.current?.focus();
    }
  }, [dialogOpen]);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setChangeError(null);
    setConfirmation('');
  }, []);

  const openDialog = useCallback(() => {
    setTargetVisibility(repository?.visibility ?? 'public');
    setConfirmation('');
    setChangeError(null);
    setDialogOpen(true);
  }, [repository]);

  const handleDialogKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) {
        return;
      }
      const focusables = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('disabled'));
      if (focusables.length === 0) {
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !dialogRef.current.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialogRef.current.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    },
    [closeDialog]
  );

  async function handleConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) {
      return;
    }
    const trimmed = confirmation.trim();
    // The confirmation text is optional (the change completes without
    // retyping the repository name); a non-empty text that does not match
    // the repository name blocks the change and the visibility stays
    // unchanged.
    if (trimmed !== '' && trimmed !== name && trimmed !== `${owner}/${name}`) {
      setChangeError('Repository name does not match');
      return;
    }
    setSubmitting(true);
    setChangeError(null);
    const result = await apiUpdateRepositoryVisibility(owner, name, {
      visibility: targetVisibility,
      confirmation: trimmed,
    });
    setSubmitting(false);
    if (result.ok) {
      setRepository(result.repository);
      setDialogOpen(false);
      setConfirmation('');
      // REQ-3-4 THEN: after a successful confirmation the system displays the
      // repository overview (the Public marker and the Code entry are shown
      // there), and the result is persisted server-side. Follow the app's
      // convention of navigating to the resulting overview page.
      navigate(`#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
    } else {
      setChangeError(
        result.errors.confirmation ??
          result.errors.visibility ??
          'The visibility could not be changed.'
      );
    }
  }

  if (denied || (repository !== null && repository.role !== 'admin')) {
    return (
      <div className="repository-page repository-denied">
        <h1>Access denied</h1>
        <p className="muted-text">
          You do not have permission to manage this repository.
        </p>
        {auth.status === 'ready' && !auth.user ? (
          <a className="primary-link" href="#/signin">
            Sign in
          </a>
        ) : null}
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="repository-page">
        <h1>Repository not found</h1>
        <p className="muted-text">
          The repository “{owner}/{name}” does not exist or is not accessible.
        </p>
      </div>
    );
  }

  if (repository === null) {
    return (
      <div className="repository-page">
        <p className="loading">Loading…</p>
      </div>
    );
  }

  const settingsHref = `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/settings`;
  const currentVisibility = visibilityLabel(repository.visibility);
  const targetLabel = visibilityLabel(targetVisibility);

  return (
    <div className="repository-page repository-settings-page">
      <h1>Settings</h1>
      <p className="repository-settings-title">
        {repository.owner}/{repository.name}
      </p>
      <nav className="settings-nav" aria-label="Repository settings">
        <a className="settings-nav-link" href={settingsHref} aria-current="page">
          General
        </a>
        <a className="settings-nav-link" href={`${settingsHref}/branches`}>
          Branches
        </a>
        <a className="settings-nav-link" href={`${settingsHref}/access`}>
          Manage access
        </a>
      </nav>
      <p className="muted-text settings-intro">
        Manage who has access to this repository.
      </p>

      <section className="danger-zone" aria-labelledby="danger-zone-heading">
        <h2 id="danger-zone-heading">Danger Zone</h2>
        <div className="danger-zone-item">
          <div className="danger-zone-item-text">
            <strong>Change repository visibility</strong>
            <p className="muted-text">
              This repository is currently {currentVisibility}. Changing the
              visibility affects who can access the repository.
            </p>
          </div>
          <button
            ref={changeButtonRef}
            type="button"
            className="danger-button"
            onClick={openDialog}
          >
            Change visibility
          </button>
        </div>
      </section>

      {dialogOpen ? (
        <div
          className="modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              closeDialog();
            }
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="visibility-dialog-title"
            className="visibility-dialog"
            onKeyDown={handleDialogKeyDown}
          >
            <h2 id="visibility-dialog-title">Change repository visibility</h2>
            <p className="visibility-dialog-text">
              You are about to change the visibility of {repository.owner}/
              {repository.name} from {currentVisibility} to {targetLabel}.
            </p>
            <form onSubmit={handleConfirm} noValidate>
              <div className="visibility-options" role="radiogroup" aria-label="Visibility">
                <label className="visibility-option">
                  <input
                    type="radio"
                    name="visibility-target"
                    value="public"
                    checked={targetVisibility === 'public'}
                    onChange={() => setTargetVisibility('public')}
                  />
                  Public
                </label>
                <label className="visibility-option">
                  <input
                    type="radio"
                    name="visibility-target"
                    value="private"
                    checked={targetVisibility === 'private'}
                    onChange={() => setTargetVisibility('private')}
                  />
                  Private
                </label>
              </div>
              <div className="field">
                <label htmlFor="visibility-confirmation">
                  Type the repository name to confirm
                </label>
                <input
                  ref={confirmationInputRef}
                  id="visibility-confirmation"
                  type="text"
                  value={confirmation}
                  placeholder="Type the repository name to confirm"
                  onChange={(e) => setConfirmation(e.target.value)}
                  aria-invalid={changeError ? true : undefined}
                  aria-describedby={
                    changeError ? 'visibility-confirmation-error' : undefined
                  }
                />
                {changeError ? (
                  <p id="visibility-confirmation-error" className="field-error">
                    {changeError}
                  </p>
                ) : null}
              </div>
              <div className="visibility-dialog-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeDialog}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={submitting}
                >
                  Confirm visibility
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
