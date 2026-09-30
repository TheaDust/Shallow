import { useEffect, useState, type FormEvent } from "react";

import { apiErrorMessage, readErrorFields } from "../lib/api";
import {
  REQUIRE_APPROVAL_LABEL,
  REQUIRE_STATUS_CHECK_LABEL,
  fetchBranchProtection,
  saveBranchProtection,
  type BranchProtectionRule,
} from "../lib/branch-protection-api";
import { Button, FormField } from "../ui";

export interface BranchProtectionPanelProps {
  owner: string;
  name: string;
  /** Only a repository Admin sees the rule form and the save controls (REQ-6-1). */
  canAdminister: boolean;
}

/**
 * The branch protection rules of one repository (REQ-6-1), shown under
 * Settings → Branches. Every stored rule is displayed with its exact branch name
 * and the summaries of its enable requirements. `Add branch protection rule`
 * opens the form with the `Branch name pattern` field, the two requirement
 * checkboxes and its `Create` (or, for an existing rule, `Save changes`) button;
 * a non-Admin gets no such entry at all, and the server refuses the save as well.
 */
export function BranchProtectionPanel({
  owner,
  name,
  canAdminister,
}: BranchProtectionPanelProps) {
  const [rules, setRules] = useState<BranchProtectionRule[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BranchProtectionRule | null>(null);
  const [branchName, setBranchName] = useState("");
  const [requireApproval, setRequireApproval] = useState(false);
  const [requireStatusCheck, setRequireStatusCheck] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchBranchProtection(owner, name).then(
      (payload) => {
        if (active) setRules(payload.rules);
      },
      (caught: unknown) => {
        if (active) {
          setRules([]);
          setLoadError(apiErrorMessage(caught, "The branch protection rules could not be loaded."));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [owner, name]);

  function openCreate() {
    setEditing(null);
    setBranchName("");
    setRequireApproval(false);
    setRequireStatusCheck(false);
    setFieldError(null);
    setError(null);
    setStatus(null);
    setFormOpen(true);
  }

  function openEdit(rule: BranchProtectionRule) {
    setEditing(rule);
    setBranchName(rule.branchName);
    setRequireApproval(rule.requireApproval);
    setRequireStatusCheck(rule.requireStatusCheck);
    setFieldError(null);
    setError(null);
    setStatus(null);
    setFormOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFieldError(null);
    setError(null);
    try {
      const payload = await saveBranchProtection(owner, name, {
        branchName,
        requireApproval,
        requireStatusCheck,
      });
      setRules(payload.rules);
      setFormOpen(false);
      setEditing(null);
      setStatus("Branch protection rule saved.");
    } catch (caught) {
      const fields = readErrorFields(caught);
      setFieldError(fields.branchName ?? null);
      setError(
        fields.branchName
          ? null
          : apiErrorMessage(caught, "The branch protection rule could not be saved."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="branch-protection" aria-labelledby="branch-protection-heading">
      <h3 id="branch-protection-heading" className="pull-section-heading">
        Branch protection rules
      </h3>
      {status ? (
        <p role="status" className="form-message">
          {status}
        </p>
      ) : null}
      {loadError ? (
        <p role="alert" className="form-message form-message--error">
          {loadError}
        </p>
      ) : null}
      {canAdminister && !formOpen ? (
        <p className="branch-protection__actions">
          <Button variant="secondary" onClick={openCreate}>
            Add branch protection rule
          </Button>
        </p>
      ) : null}

      {formOpen ? (
        <form className="branch-protection__form" aria-label="Branch protection rule" onSubmit={(event) => void submit(event)}>
          <FormField id="branch-protection-pattern" label="Branch name pattern" error={fieldError ?? undefined}>
            <input
              id="branch-protection-pattern"
              type="text"
              autoComplete="off"
              value={branchName}
              onChange={(event) => setBranchName(event.target.value)}
            />
          </FormField>
          <p className="ui-field ui-field--checkbox">
            <label htmlFor="branch-protection-approval">
              <input
                id="branch-protection-approval"
                type="checkbox"
                checked={requireApproval}
                onChange={(event) => setRequireApproval(event.target.checked)}
              />
              {REQUIRE_APPROVAL_LABEL}
            </label>
          </p>
          <p className="ui-field ui-field--checkbox">
            <label htmlFor="branch-protection-check">
              <input
                id="branch-protection-check"
                type="checkbox"
                checked={requireStatusCheck}
                onChange={(event) => setRequireStatusCheck(event.target.checked)}
              />
              {REQUIRE_STATUS_CHECK_LABEL}
            </label>
          </p>
          <Button type="submit" variant="primary" disabled={busy}>
            {editing ? "Save changes" : "Create"}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setFormOpen(false);
              setEditing(null);
            }}
          >
            Cancel
          </Button>
          {error ? (
            <p role="alert" className="form-message form-message--error">
              {error}
            </p>
          ) : null}
        </form>
      ) : rules === null ? (
        <p role="status">Loading branch protection rules…</p>
      ) : rules.length === 0 ? (
        <p className="branch-protection__empty">No branch protection rules.</p>
      ) : (
        <ul className="branch-protection__list">
          {rules.map((rule) => (
            <li key={rule.id} className="branch-protection__rule">
              <span className="branch-protection__branch">{rule.branchName}</span>
              <ul className="branch-protection__summaries">
                {rule.summaries.map((summary) => (
                  <li key={summary} className="branch-protection__summary">
                    {summary}
                  </li>
                ))}
              </ul>
              {canAdminister ? (
                <Button aria-label={`Edit rule for ${rule.branchName}`} onClick={() => openEdit(rule)}>
                  Edit
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
