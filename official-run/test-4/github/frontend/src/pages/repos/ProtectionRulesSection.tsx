import { useCallback, useEffect, useState } from "react";

import {
  fetchProtectionRules,
  ProtectionRule,
  saveProtectionRule,
} from "../../lib/pull-api";
import { RepoDetail, RepoOwnerType } from "../../lib/repo-api";

interface ProtectionRulesSectionProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
  repository: RepoDetail;
}

interface RuleFormProps {
  initial?: ProtectionRule;
  submitLabel: "Create" | "Save changes";
  onSubmit: (input: {
    branch: string;
    requireApproval: boolean;
    requireStatusCheck: boolean;
  }) => Promise<{ ok: boolean; error: string | null }>;
  onClose: () => void;
}

/**
 * The branch-protection rule form (REQ-6-1): a field labeled “Branch name
 * pattern” holding one exact branch name, the “Require 1 approval” and
 * “Require status check test” checkboxes, and a Create / Save changes button.
 * Only one form is rendered at a time, so every control name stays unique on
 * the page.
 */
function ProtectionRuleForm({ initial, submitLabel, onSubmit, onClose }: RuleFormProps) {
  const [branch, setBranch] = useState(initial?.branch ?? "");
  const [requireApproval, setRequireApproval] = useState(initial?.requireApproval ?? false);
  const [requireStatusCheck, setRequireStatusCheck] = useState(initial?.requireStatusCheck ?? false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const outcome = await onSubmit({
      branch: branch.trim(),
      requireApproval,
      requireStatusCheck,
    });
    setSubmitting(false);
    if (!outcome.ok) {
      setError(outcome.error);
      return;
    }
    onClose();
  }

  return (
    <form
      className="protection-rule__form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="account-form__label" htmlFor="branch-name-pattern">
        Branch name pattern
      </label>
      <input
        id="branch-name-pattern"
        className="account-form__input"
        type="text"
        value={branch}
        onChange={(event) => {
          setBranch(event.target.value);
          setError(null);
        }}
      />
      <label className="account-form__checkbox">
        <input
          type="checkbox"
          checked={requireApproval}
          onChange={(event) => setRequireApproval(event.target.checked)}
        />
        Require 1 approval
      </label>
      <label className="account-form__checkbox">
        <input
          type="checkbox"
          checked={requireStatusCheck}
          onChange={(event) => setRequireStatusCheck(event.target.checked)}
        />
        Require status check test
      </label>
      {error && (
        <p role="alert" className="branch-selector__error">
          {error}
        </p>
      )}
      <div className="sign-out-dialog__actions">
        <button type="submit" className="button button--primary" disabled={submitting}>
          {submitLabel}
        </button>
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Settings → Branches branch-protection section (REQ-6-1). A repository Admin
 * (or organization Owner) can create a rule through “Add branch protection
 * rule” and edit an existing rule through “Save changes”; every rule displays
 * its exact branch name with the “1 approval” and “Require status check test”
 * summaries. Non-Admins see the read-only rule list and no add or edit
 * controls; the server rejects their save attempts anyway.
 */
export function ProtectionRulesSection({
  ownerType,
  ownerName,
  repoName,
  repository,
}: ProtectionRulesSectionProps) {
  const isAdmin = repository.currentRole === "admin";
  const [rules, setRules] = useState<ProtectionRule[]>([]);
  const [formState, setFormState] = useState<"new" | ProtectionRule["branch"] | null>(null);

  const refresh = useCallback(() => {
    return fetchProtectionRules(ownerType, ownerName, repoName)
      .then((result) => setRules(result.rules))
      .catch(() => setRules([]));
  }, [ownerType, ownerName, repoName]);

  useEffect(() => {
    let cancelled = false;
    fetchProtectionRules(ownerType, ownerName, repoName)
      .then((result) => {
        if (!cancelled) setRules(result.rules);
      })
      .catch(() => {
        if (!cancelled) setRules([]);
      });
    return () => {
      cancelled = true;
    };
  }, [ownerType, ownerName, repoName, refresh]);

  async function handleSubmit(input: {
    branch: string;
    requireApproval: boolean;
    requireStatusCheck: boolean;
  }): Promise<{ ok: boolean; error: string | null }> {
    const outcome = await saveProtectionRule(ownerType, ownerName, repoName, input);
    if (outcome.ok) {
      setRules(outcome.rules);
      return { ok: true, error: null };
    }
    return { ok: false, error: outcome.errors.branch ?? "Could not save the branch protection rule" };
  }

  const editingRule =
    formState && formState !== "new"
      ? rules.find((rule) => rule.branch === formState) ?? null
      : null;

  return (
    <section className="settings-section" aria-label="Branch protection rules">
      <h2>Branch protection rules</h2>
      <p>
        Choose the merge requirements enforced for one exact branch name. Direct writes to a
        protected branch are blocked.
      </p>
      {isAdmin && !formState && (
        <button
          type="button"
          className="button"
          onClick={() => setFormState("new")}
        >
          Add branch protection rule
        </button>
      )}
      {isAdmin && formState && (
        <ProtectionRuleForm
          initial={editingRule ?? undefined}
          submitLabel={formState === "new" ? "Create" : "Save changes"}
          onSubmit={handleSubmit}
          onClose={() => setFormState(null)}
        />
      )}
      {rules.length === 0 ? (
        <p>No branch protection rules.</p>
      ) : (
        <ul className="protection-rules">
          {rules.map((rule) => (
            <li key={rule.branch} className="protection-rule">
              <div className="protection-rule__summary">
                <span className="protection-rule__branch">{rule.branch}</span>
                {rule.requireApproval && <span>1 approval</span>}
                {rule.requireStatusCheck && <span>Require status check test</span>}
              </div>
              {isAdmin && formState !== rule.branch && (
                <button
                  type="button"
                  className="button"
                  onClick={() => setFormState(rule.branch)}
                >
                  Save changes
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
