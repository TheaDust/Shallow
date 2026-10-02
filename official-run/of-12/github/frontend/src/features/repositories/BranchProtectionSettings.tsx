import { useId, useState, type FormEvent } from "react";

import { Button, FormField } from "../../ui";
import { saveBranchProtectionRule, type RepositoryOverview } from "./repository-api";

export interface BranchProtectionSettingsProps {
  repository: RepositoryOverview;
  /** Re-reads the repository, so the stored rule is displayed from the server. */
  onSaved(): void;
}

/**
 * Branch protection rules on the Branches settings page (REQ-6-1).
 *
 * Every stored rule is spelled with its exact branch name and the summaries
 * "1 approval" and "Require status check test"; the rule form opens from the
 * "Add branch protection rule" button and holds the field "Branch name pattern"
 * (an exact branch name, never a wildcard), the checkboxes "Require 1 approval"
 * and "Require status check test" and the submit "Create" — or "Save changes"
 * once the entered branch name already carries a rule. Only a repository Admin
 * sees the entry; the server refuses every other caller as well.
 */
export function BranchProtectionSettings({ repository, onSaved }: BranchProtectionSettingsProps) {
  const fieldId = useId();
  const rules = repository.protectionRules ?? [];
  const [open, setOpen] = useState(false);
  const [pattern, setPattern] = useState("");
  const [requireApproval, setRequireApproval] = useState(false);
  const [requireStatusCheck, setRequireStatusCheck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const existing = rules.find((rule) => rule.pattern === pattern.trim());
  const submitLabel = existing ? "Save changes" : "Create";

  function changePattern(value: string) {
    setPattern(value);
    // The form follows the rule of the entered branch name as long as the
    // branch name is unchanged, so an existing rule is edited with its stored
    // requirements instead of a second, conflicting rule.
    const match = rules.find((rule) => rule.pattern === value.trim());
    setRequireApproval(match?.requireApproval ?? false);
    setRequireStatusCheck(match?.requireStatusCheck ?? false);
    setError(null);
    setStatus(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setStatus(null);
    const result = await saveBranchProtectionRule(repository.owner, repository.name, {
      pattern: pattern.trim(),
      requireApproval,
      requireStatusCheck,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.errors.pattern ?? result.message);
      return;
    }
    setStatus("The branch protection rule was saved.");
    setOpen(false);
    setPattern("");
    setRequireApproval(false);
    setRequireStatusCheck(false);
    onSaved();
  }

  return (
    <section className="branch-protection" aria-label="Branch protection">
      <h2 className="branch-protection__heading">Branch protection rules</h2>
      {status ? <p role="status">{status}</p> : null}

      {rules.length > 0 ? (
        <ul className="branch-protection__rules">
          {rules.map((rule) => (
            <li key={rule.id || rule.pattern} className="branch-protection__rule">
              <p className="branch-protection__pattern">{rule.pattern}</p>
              <ul className="branch-protection__requirements">
                {rule.requireApproval ? <li className="branch-protection__requirement">1 approval</li> : null}
                {rule.requireStatusCheck ? (
                  <li className="branch-protection__requirement">Require status check test</li>
                ) : null}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <p className="branch-protection__empty">No branch protection rules yet.</p>
      )}

      {repository.canManageBranchProtection ? (
        <>
          <Button variant="secondary" onClick={() => setOpen((current) => !current)}>
            Add branch protection rule
          </Button>
          {open ? (
            <form className="branch-protection__form" noValidate onSubmit={submit}>
              <FormField id={`${fieldId}-pattern`} label="Branch name pattern">
                <input
                  id={`${fieldId}-pattern`}
                  name="pattern"
                  type="text"
                  value={pattern}
                  onChange={(event) => changePattern(event.target.value)}
                />
              </FormField>
              <p className="branch-protection__checkbox">
                <input
                  id={`${fieldId}-approval`}
                  name="requireApproval"
                  type="checkbox"
                  checked={requireApproval}
                  onChange={(event) => setRequireApproval(event.target.checked)}
                />
                <label htmlFor={`${fieldId}-approval`}>Require 1 approval</label>
              </p>
              <p className="branch-protection__checkbox">
                <input
                  id={`${fieldId}-check`}
                  name="requireStatusCheck"
                  type="checkbox"
                  checked={requireStatusCheck}
                  onChange={(event) => setRequireStatusCheck(event.target.checked)}
                />
                <label htmlFor={`${fieldId}-check`}>Require status check test</label>
              </p>
              {error ? (
                <p className="branch-protection__error" role="alert">
                  {error}
                </p>
              ) : null}
              <Button type="submit" variant="primary" disabled={saving}>
                {submitLabel}
              </Button>
            </form>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
