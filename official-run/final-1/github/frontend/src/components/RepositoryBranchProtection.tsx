import { useState, type FormEvent } from "react";

import {
  fetchBranchProtectionRules,
  saveBranchProtectionRule,
  type BranchProtectionRule,
} from "../lib/org-api";
import { useAsyncData } from "../lib/use-async";
import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";
import { ErrorNote, LoadingNote } from "./ViewState";

/**
 * "Branch protection" section of the repository settings (REQ-6-1). A
 * repository Admin or organization Owner creates a persistent rule bound to one
 * exact branch through `Add branch protection rule`, `Branch name pattern`,
 * `Require 1 approval`, `Require status check test` and `Create`; the saved
 * rules are read back from the stored record, so they survive a reload. A
 * non-Administrator never receives the creation control, and the server refuses
 * the request as well.
 */
export function RepositoryBranchProtection({
  owner,
  name,
  canManage,
}: {
  owner: string;
  name: string;
  canManage: boolean;
}) {
  const { status, data, error, reload } = useAsyncData(
    () => fetchBranchProtectionRules(owner, name),
    [owner, name],
  );
  const [open, setOpen] = useState(false);
  const [pattern, setPattern] = useState("");
  const [requireApprovals, setRequireApprovals] = useState(false);
  const [requireStatusCheck, setRequireStatusCheck] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rules: BranchProtectionRule[] = data?.rules ?? [];
  const mayManage = data ? data.canManage : canManage;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFieldError(null);
    const result = await saveBranchProtectionRule(owner, name, {
      branchName: pattern,
      requireApprovals,
      requireStatusCheck,
    });
    setBusy(false);
    if (!result.ok) {
      setFieldError(result.fieldErrors.branchName ?? result.message);
      return;
    }
    // The form closes so the saved rule is the only description of the branch.
    setOpen(false);
    setPattern("");
    setRequireApprovals(false);
    setRequireStatusCheck(false);
    reload();
  };

  return (
    <div className="branch-protection" role="region" aria-label="Branch protection">
      <h2 className="branch-protection__title">Branch protection</h2>
      {status === "error" && error ? <ErrorNote error={error} onRetry={reload} /> : null}
      {status === "loading" && !data ? <LoadingNote label="Loading branch protection…" /> : null}
      {mayManage ? (
        <Button
          variant="secondary"
          aria-expanded={open}
          onClick={() => {
            setFieldError(null);
            setOpen(true);
          }}
        >
          Add branch protection rule
        </Button>
      ) : (
        <p className="branch-protection__hint">
          You need administrator permission on this repository to create a branch protection rule.
        </p>
      )}
      {mayManage && open ? (
        <form className="branch-protection__form" onSubmit={submit}>
          <FormField
            id="branch-name-pattern"
            label="Branch name pattern"
            error={fieldError ?? undefined}
          >
            <input
              id="branch-name-pattern"
              name="branchName"
              type="text"
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
            />
          </FormField>
          <FormField id="branch-require-approvals" label="Require 1 approval">
            <input
              id="branch-require-approvals"
              name="requireApprovals"
              type="checkbox"
              checked={requireApprovals}
              onChange={(event) => setRequireApprovals(event.target.checked)}
            />
          </FormField>
          <FormField id="branch-require-status-check" label="Require status check test">
            <input
              id="branch-require-status-check"
              name="requireStatusCheck"
              type="checkbox"
              checked={requireStatusCheck}
              onChange={(event) => setRequireStatusCheck(event.target.checked)}
            />
          </FormField>
          <Button type="submit" variant="primary" disabled={busy}>
            Create
          </Button>
        </form>
      ) : null}
      {data ? (
        <ul className="branch-protection__rules" aria-label="Branch protection rules">
          {rules.map((rule) => (
            <li key={rule.id} className="branch-protection__rule">
              <h3 className="branch-protection__branch">{rule.branchName}</h3>
              {rule.requireApprovals ? (
                <p className="branch-protection__requirement">1 approval</p>
              ) : null}
              {rule.requireStatusCheck ? (
                <p className="branch-protection__requirement">Require status check test</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
