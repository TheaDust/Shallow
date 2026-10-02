import { useId, useState } from "react";

import { ApiError } from "../../lib/api";
import {
  saveBranchProtectionRule,
  type RepositoryBranchProtectionRule,
} from "../../lib/repository-code-api";
import { Button, Dialog, FormField } from "../../ui";

export interface BranchProtectionRulesProps {
  owner: string;
  name: string;
  /** True only for a repository Admin (or organization Owner). */
  canAdminister: boolean;
  rules: RepositoryBranchProtectionRule[];
  /** The stored rules after an accepted save. */
  onSaved(rules: RepositoryBranchProtectionRule[]): void;
}

/**
 * The branch protection rules of one repository, displayed under
 * `Settings` → `Branches`. Every reader sees the stored rules verbatim — the
 * exact branch name next to the summaries `1 approval` and
 * `Require status check test` — while the `Add branch protection rule` entry,
 * its form and its save button exist for a repository Admin only. The form
 * holds the field `Branch name pattern` (an exact branch name, with no
 * wildcard semantics), the two independent checkboxes and one submit button:
 * `Create` while the typed name carries no rule, `Save changes` while it does.
 */
export function BranchProtectionRules({
  owner,
  name,
  canAdminister,
  rules,
  onSaved,
}: BranchProtectionRulesProps) {
  const [open, setOpen] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [requireApproval, setRequireApproval] = useState(false);
  const [requireStatusCheck, setRequireStatusCheck] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const patternId = useId();

  const pattern = branchName.trim();
  const existing = rules.find((rule) => rule.branchName === pattern) ?? null;

  function openForm(): void {
    setBranchName("");
    setRequireApproval(false);
    setRequireStatusCheck(false);
    setFieldError(null);
    setError(null);
    setOpen(true);
  }

  async function save(): Promise<void> {
    if (pattern.length === 0) {
      setFieldError("Branch name pattern is required");
      return;
    }
    setBusy(true);
    setError(null);
    setFieldError(null);
    try {
      const result = await saveBranchProtectionRule(owner, name, {
        branchName: pattern,
        requireApproval,
        requireStatusCheck,
      });
      onSaved(result.branchProtectionRules);
      setOpen(false);
      setStatus("Branch protection rule saved.");
    } catch (failure) {
      const body = failure instanceof ApiError ? failure.body : null;
      const fieldErrors =
        body && typeof body === "object" && "fieldErrors" in body
          ? ((body as { fieldErrors?: Record<string, string> }).fieldErrors ?? {})
          : {};
      setFieldError(fieldErrors.branchName ?? null);
      setError(failure instanceof ApiError ? failure.message : "The rule was not saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="repository-settings__protection" aria-label="Branch protection rules">
      <h2>Branch protection rules</h2>
      {status ? (
        <p className="repository-settings__status" role="status">
          {status}
        </p>
      ) : null}
      {error ? (
        <p className="repository-settings__error" role="alert">
          {error}
        </p>
      ) : null}
      {rules.length === 0 ? (
        <p className="branch-protection__empty" role="status">
          No branch protection rules
        </p>
      ) : (
        <ul className="branch-protection__list">
          {rules.map((rule) => (
            <li key={rule.id} className="branch-protection__rule">
              {/* The stored branch name is visible verbatim. */}
              <span className="branch-protection__branch">{rule.branchName}</span>
              {rule.requirements.map((requirement) => (
                <span key={requirement} className="branch-protection__requirement">
                  {requirement}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      {canAdminister ? (
        <Button type="button" onClick={openForm}>
          Add branch protection rule
        </Button>
      ) : (
        <p className="branch-protection__read-only">
          The branch protection rules can only be changed by a repository administrator.
        </p>
      )}
      {canAdminister && open ? (
        <Dialog
          open
          title="Branch protection rule"
          onOpenChange={setOpen}
          actions={
            <>
              <Button type="button" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" variant="primary" disabled={busy} onClick={() => void save()}>
                {existing ? "Save changes" : "Create"}
              </Button>
            </>
          }
        >
          <FormField id={patternId} label="Branch name pattern" error={fieldError ?? undefined}>
            <input
              id={patternId}
              name="branchName"
              type="text"
              autoComplete="off"
              value={branchName}
              onChange={(event) => {
                setBranchName(event.target.value);
                setFieldError(null);
              }}
            />
          </FormField>
          <label className="branch-protection__toggle">
            <input
              type="checkbox"
              name="requireApproval"
              checked={requireApproval}
              onChange={(event) => setRequireApproval(event.target.checked)}
            />
            Require 1 approval
          </label>
          <label className="branch-protection__toggle">
            <input
              type="checkbox"
              name="requireStatusCheck"
              checked={requireStatusCheck}
              onChange={(event) => setRequireStatusCheck(event.target.checked)}
            />
            Require status check test
          </label>
        </Dialog>
      ) : null}
    </section>
  );
}
