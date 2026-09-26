import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  apiRepository,
  apiRepositoryBranches,
  apiUpdateRepositoryDefaultBranch,
  apiBranchProtectionRules,
  apiCreateBranchProtectionRule,
  apiUpdateBranchProtectionRule,
} from '../api';
import { useSession } from '../session';
import type {
  BranchProtectionRule,
  RepositoryBranchInfo,
  RepositoryOverview,
} from '../types';

interface RepositoryBranchesSettingsPageProps {
  owner: string;
  name: string;
}

/**
 * REQ-4-3-3: the “Branches” tab of repository settings. A repository
 * administrator selects an existing branch from the “Default branch” dropdown
 * (a native HTML select exposing the combobox role, options labeled by the
 * exact existing branch names), clicks “Update” and confirms in the
 * confirmation dialog (“Confirm”); the server stores the new default branch
 * together with the operator and time without deleting or rewriting the
 * previous default branch. The saved default branch is the initial branch
 * shown when the repository is newly opened, and the old default branch stays
 * selectable in the Code page branch selector. Only a repository Admin or
 * organization Owner may change the default branch; other roles never see the
 * combobox or the update button (a non-Admin opening this page sees Access
 * denied, and the server rejects unauthorized requests), so a merely disabled
 * selector never appears for them.
 */
export default function RepositoryBranchesSettingsPage({
  owner,
  name,
}: RepositoryBranchesSettingsPageProps) {
  const { auth } = useSession();
  const [repository, setRepository] = useState<RepositoryOverview | null>(null);
  const [branches, setBranches] = useState<RepositoryBranchInfo[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [denied, setDenied] = useState(false);
  const [notFound, setNotFound] = useState(false);

  // Default-branch change state.
  const [selectedBranch, setSelectedBranch] = useState('');
  const [pendingBranch, setPendingBranch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [updated, setUpdated] = useState(false);

  // REQ-6-1 branch-protection state.
  const [rules, setRules] = useState<BranchProtectionRule[] | null>(null);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [ruleFormOpen, setRuleFormOpen] = useState(false);
  const [ruleBranchName, setRuleBranchName] = useState('');
  const [ruleRequireApproval, setRuleRequireApproval] = useState(false);
  const [ruleRequireStatusCheck, setRuleRequireStatusCheck] = useState(false);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [ruleSubmitting, setRuleSubmitting] = useState(false);

  const updateButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    setRepository(null);
    setBranches(null);
    setLoadError(false);
    setDenied(false);
    setNotFound(false);
    setDialogOpen(false);
    setPendingBranch('');
    setUpdateError(null);
    setUpdated(false);
    setRules(null);
    setRulesError(null);
    setRuleFormOpen(false);
    setRuleBranchName('');
    setRuleRequireApproval(false);
    setRuleRequireStatusCheck(false);
    setRuleError(null);
    apiRepository(owner, name).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setRepository(result.repository);
        setSelectedBranch(result.repository.defaultBranch);
      } else if (result.status === 403) {
        setDenied(true);
      } else {
        setNotFound(true);
      }
    });
    apiRepositoryBranches(owner, name).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setBranches(result.branches);
      } else if (result.status === 403) {
        setDenied(true);
      } else if (result.status === 404) {
        setNotFound(true);
      } else {
        setLoadError(true);
      }
    });
    // REQ-6-1: the branch protection rules of the repository (only a
    // repository Admin or organization Owner may read them; the page gates
    // the controls on the same role).
    apiBranchProtectionRules(owner, name).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setRules(result.rules);
      } else if (result.status === 403) {
        setDenied(true);
      } else {
        setRulesError(result.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [owner, name]);

  // Focus the Cancel button when the dialog opens; restore focus to the
  // Update button when it closes.
  useEffect(() => {
    if (dialogOpen) {
      cancelButtonRef.current?.focus();
    } else {
      updateButtonRef.current?.focus();
    }
  }, [dialogOpen]);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setPendingBranch('');
    setUpdateError(null);
  }, []);

  const openDialog = useCallback(() => {
    setPendingBranch(selectedBranch);
    setUpdateError(null);
    setDialogOpen(true);
  }, [selectedBranch]);

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

  async function handleConfirm() {
    if (submitting || pendingBranch === '') {
      return;
    }
    setSubmitting(true);
    setUpdateError(null);
    const result = await apiUpdateRepositoryDefaultBranch(owner, name, pendingBranch);
    setSubmitting(false);
    if (result.ok) {
      // The saved default branch becomes the initial branch of the newly
      // opened repository; keep this page in sync and refresh the list so
      // only existing branches are selectable afterwards.
      setRepository(result.repository);
      setSelectedBranch(result.repository.defaultBranch);
      setDialogOpen(false);
      setPendingBranch('');
      setUpdated(true);
      apiRepositoryBranches(owner, name).then((listResult) => {
        if (listResult.ok) {
          setBranches(listResult.branches);
        }
      });
    } else {
      setUpdateError(result.message);
    }
  }

  async function handleSaveRule() {
    if (ruleSubmitting) {
      return;
    }
    const trimmedName = ruleBranchName.trim();
    if (trimmedName === '') {
      setRuleError('Branch name pattern is required');
      return;
    }
    setRuleSubmitting(true);
    setRuleError(null);
    const existingRule = (rules ?? []).find(
      (rule) => rule.branchName === trimmedName
    );
    const payload = {
      branchName: trimmedName,
      requireApproval: ruleRequireApproval,
      requireStatusCheck: ruleRequireStatusCheck,
    };
    const result = existingRule
      ? await apiUpdateBranchProtectionRule(owner, name, trimmedName, {
          requireApproval: ruleRequireApproval,
          requireStatusCheck: ruleRequireStatusCheck,
        })
      : await apiCreateBranchProtectionRule(owner, name, payload);
    setRuleSubmitting(false);
    if (result.ok) {
      setRules(result.rules);
      setRuleFormOpen(false);
      setRuleBranchName('');
      setRuleRequireApproval(false);
      setRuleRequireStatusCheck(false);
    } else {
      setRuleError(result.message);
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

  if (repository === null || branches === null) {
    return (
      <div className="repository-page">
        <p className="loading">Loading…</p>
      </div>
    );
  }

  const settingsHref = `#/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/settings`;

  return (
    <div className="repository-page repository-settings-page">
      <h1>Branches</h1>
      <p className="repository-settings-title">
        {repository.owner}/{repository.name}
      </p>
      <nav className="settings-nav" aria-label="Repository settings">
        <a className="settings-nav-link" href={settingsHref}>
          Settings
        </a>
        <a
          className="settings-nav-link"
          href={`${settingsHref}/branches`}
          aria-current="page"
        >
          Branches
        </a>
        <a className="settings-nav-link" href={`${settingsHref}/access`}>
          Manage access
        </a>
      </nav>

      {loadError ? (
        <p role="alert" className="form-error">
          The branches could not be loaded.
        </p>
      ) : (
        <>
          <section className="default-branch-section">
            <h2 id="default-branch-heading">Default branch</h2>
            <div className="default-branch-form">
              <div className="field default-branch-field">
                <label htmlFor="default-branch-select">Default branch</label>
                <select
                  id="default-branch-select"
                  value={selectedBranch}
                  onChange={(event) => {
                    setSelectedBranch(event.target.value);
                    setUpdated(false);
                  }}
                >
                  {branches.map((branch) => (
                    <option key={branch.name} value={branch.name}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                ref={updateButtonRef}
                type="button"
                className="primary-button"
                onClick={openDialog}
              >
                Update
              </button>
            </div>
            {updated ? (
              <p role="status" className="default-branch-updated">
                Default branch updated
              </p>
            ) : null}
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
                aria-labelledby="default-branch-dialog-title"
                className="default-branch-dialog"
                onKeyDown={handleDialogKeyDown}
              >
                <h2 id="default-branch-dialog-title">Change default branch</h2>
                <p className="default-branch-dialog-text">
                  You are about to change the default branch of {repository.owner}/
                  {repository.name} from {repository.defaultBranch} to{' '}
                  {pendingBranch}.
                </p>
                {updateError ? (
                  <p role="alert" className="form-error">
                    {updateError}
                  </p>
                ) : null}
                <div className="default-branch-dialog-actions">
                  <button
                    ref={cancelButtonRef}
                    type="button"
                    className="secondary-button"
                    onClick={closeDialog}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={submitting}
                    onClick={() => void handleConfirm()}
                  >
                    Confirm
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {/* REQ-6-1: branch protection rules. Only a repository Admin or
              organization Owner reaches this page, so the “Add branch
              protection rule” button and the rule form are never rendered for
              a non-Admin (rejecting a save alone would be insufficient). The
              rule form contains a field labeled “Branch name pattern” (an
              exact branch name, no wildcard semantics), checkboxes named
              “Require 1 approval” and “Require status check test”, and a
              submit button that reads “Create” for a new branch name or
              “Save changes” when a rule already exists for the entered
              branch. After saving and reloading the branch name is visible
              verbatim with the summaries “1 approval” and “Require status
              check test”. */}
          <section className="branch-protection-section">
            <h2 id="branch-protection-heading">Branch protection rules</h2>
            <button
              type="button"
              className="secondary-button"
              aria-expanded={ruleFormOpen}
              onClick={() => setRuleFormOpen((open) => !open)}
            >
              Add branch protection rule
            </button>
            {ruleFormOpen ? (
              <div className="branch-protection-form">
                <div className="field">
                  <label htmlFor="branch-name-pattern">Branch name pattern</label>
                  <input
                    id="branch-name-pattern"
                    type="text"
                    value={ruleBranchName}
                    onChange={(event) => {
                      setRuleBranchName(event.target.value);
                      setRuleError(null);
                    }}
                    placeholder="Branch name pattern"
                  />
                </div>
                <div className="field-checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={ruleRequireApproval}
                      onChange={(event) =>
                        setRuleRequireApproval(event.target.checked)
                      }
                    />
                    Require 1 approval
                  </label>
                </div>
                <div className="field-checkbox">
                  <label>
                    <input
                      type="checkbox"
                      checked={ruleRequireStatusCheck}
                      onChange={(event) =>
                        setRuleRequireStatusCheck(event.target.checked)
                      }
                    />
                    Require status check test
                  </label>
                </div>
                {ruleError ? (
                  <p role="alert" className="form-error">
                    {ruleError}
                  </p>
                ) : null}
                <button
                  type="button"
                  className="primary-button"
                  disabled={ruleSubmitting}
                  onClick={() => void handleSaveRule()}
                >
                  {(rules ?? []).some(
                    (rule) => rule.branchName === ruleBranchName.trim()
                  )
                    ? 'Save changes'
                    : 'Create'}
                </button>
              </div>
            ) : null}
            {rulesError ? (
              <p role="alert" className="form-error">
                {rulesError}
              </p>
            ) : rules === null ? (
              <p className="loading">Loading…</p>
            ) : rules.length === 0 ? (
              <p className="muted-text">No branch protection rules.</p>
            ) : (
              <ul className="branch-protection-rules">
                {rules.map((rule) => (
                  <li key={rule.branchName} className="branch-protection-rule">
                    <span className="branch-protection-rule-name">
                      {rule.branchName}
                    </span>
                    {rule.requireApproval ? (
                      <span className="branch-protection-requirement">
                        1 approval
                      </span>
                    ) : null}
                    {rule.requireStatusCheck ? (
                      <span className="branch-protection-requirement">
                        Require status check test
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
