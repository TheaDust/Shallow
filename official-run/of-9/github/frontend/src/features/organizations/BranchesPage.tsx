import { useEffect, useState, type FormEvent } from "react";

import { ApiError } from "../../lib/api";
import { Button, Dialog } from "../../ui";
import { listProtectionRules, setProtectionRule, type ProtectionRule } from "../pulls/api";
import {
  getRepository,
  getRepositoryBranches,
  updateRepositoryDefaultBranch,
  type RepositoryOverview,
} from "./api";
import { AccessDenied } from "./AccessDenied";
import { RepositorySettingsNav } from "./RepositorySettingsNav";

export function BranchesPage({ owner, name }: { owner: string; name: string }) {
  const [repository, setRepository] = useState<RepositoryOverview | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [rules, setRules] = useState<ProtectionRule[]>([]);
  const [selected, setSelected] = useState("");
  const [denied, setDenied] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Branch protection rule form state (REQ-6-1).
  const [ruleFormOpen, setRuleFormOpen] = useState(false);
  const [ruleBranch, setRuleBranch] = useState("");
  const [ruleApproval, setRuleApproval] = useState(false);
  const [ruleCheck, setRuleCheck] = useState(false);
  const [ruleErrors, setRuleErrors] = useState<Record<string, string>>({});
  const [ruleBusy, setRuleBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getRepository(owner, name),
      getRepositoryBranches(owner, name),
      listProtectionRules(owner, name).catch(() => []),
    ])
      .then(([repo, list, ruleList]) => {
        if (cancelled) return;
        setRepository(repo);
        setBranches(list);
        setRules(ruleList);
        setSelected(repo.defaultBranch);
        if (repo.myRole !== "admin") setDenied(true);
      })
      .catch(() => {
        if (!cancelled) setDenied(true);
      });
    return () => {
      cancelled = true;
    };
  }, [owner, name]);

  if (denied) return <AccessDenied />;
  if (!repository) {
    return (
      <p role="status" className="page-status">
        Loading…
      </p>
    );
  }

  const confirmUpdate = async () => {
    if (busy || !repository) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateRepositoryDefaultBranch(owner, name, selected);
      setRepository(updated);
      setDialogOpen(false);
      setNotice(`Default branch changed to ${updated.defaultBranch}`);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof ApiError ? requestError.message : "Unable to change the default branch",
      );
    } finally {
      setBusy(false);
    }
  };

  const openRuleForm = (rule: ProtectionRule | null) => {
    setRuleBranch(rule?.branch ?? "");
    setRuleApproval(rule?.requireApproval ?? false);
    setRuleCheck(rule?.requireCheck ?? false);
    setRuleErrors({});
    setRuleFormOpen(true);
  };

  const existingRuleForBranch = (branch: string) =>
    rules.find((rule) => rule.branch === branch) ?? null;

  const saveRule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (ruleBusy) return;
    setRuleBusy(true);
    setRuleErrors({});
    const result = await setProtectionRule(owner, name, {
      branch: ruleBranch,
      requireApproval: ruleApproval,
      requireCheck: ruleCheck,
    });
    setRuleBusy(false);
    if (result.ok) {
      setRuleFormOpen(false);
      setNotice(`Branch protection rule saved for ${result.rule.branch}`);
      const refreshed = await listProtectionRules(owner, name).catch(() => []);
      setRules(refreshed);
      return;
    }
    setRuleErrors(result.errors);
  };

  const submitLabel = existingRuleForBranch(ruleBranch.trim()) ? "Save changes" : "Create";

  return (
    <section className="repository-settings">
      <header className="repository-settings__header">
        <h1>Settings</h1>
        <p>
          {owner}/{name}
        </p>
      </header>
      <RepositorySettingsNav owner={owner} name={name} tab="branches" />

      {notice ? (
        <p role="status" className="repository-settings__notice">
          {notice}
        </p>
      ) : null}

      <section className="default-branch-section">
        <h2>Default branch</h2>
        <p className="default-branch-section__text">
          The default branch is read when the repository is opened without a branch.
        </p>
        <div className="default-branch-section__form">
          <label htmlFor="default-branch-select">Default branch</label>
          <select
            id="default-branch-select"
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value);
              setError(null);
            }}
          >
            {branches.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
          <Button onClick={() => setDialogOpen(true)}>Update</Button>
        </div>
      </section>

      <section className="protection-rules-section">
        <h2>Branch protection rules</h2>
        <p className="protection-rules-section__text">
          Protect one exact branch by requiring reviews and passing status checks
          before merging.
        </p>
        <Button
          variant="primary"
          className="protection-rules-section__add"
          onClick={() => openRuleForm(null)}
        >
          Add branch protection rule
        </Button>
        {rules.length === 0 ? (
          <p className="protection-rules-section__empty">No branch protection rules yet.</p>
        ) : (
          <ul className="protection-rules">
            {rules.map((rule) => (
              <li key={rule.branch} className="protection-rules__item">
                <div className="protection-rules__identity">
                  <span className="protection-rules__branch">{rule.branch}</span>
                  <ul className="protection-rules__summaries">
                    {rule.requireApproval ? (
                      <li className="protection-rules__summary">1 approval</li>
                    ) : null}
                    {rule.requireCheck ? (
                      <li className="protection-rules__summary">Require status check test</li>
                    ) : null}
                  </ul>
                </div>
                <Button onClick={() => openRuleForm(rule)}>Edit</Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog
        open={dialogOpen}
        title="Change default branch"
        onOpenChange={setDialogOpen}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void confirmUpdate()}>
              Confirm
            </Button>
          </>
        }
      >
        <p>
          Set the default branch of {owner}/{name} to <strong>{selected}</strong>?
        </p>
        {error ? (
          <p role="alert" className="repository-settings__error">
            {error}
          </p>
        ) : null}
      </Dialog>

      <Dialog
        open={ruleFormOpen}
        title={
          existingRuleForBranch(ruleBranch.trim())
            ? "Edit branch protection rule"
            : "Add branch protection rule"
        }
        onOpenChange={setRuleFormOpen}
      >
        <form className="protection-rule-form" onSubmit={saveRule}>
          <div className="ui-field">
            <label htmlFor="rule-branch-pattern">Branch name pattern</label>
            <input
              id="rule-branch-pattern"
              value={ruleBranch}
              onChange={(event) => {
                setRuleBranch(event.target.value);
                if (ruleErrors.branch) {
                  setRuleErrors((previous) => {
                    const next = { ...previous };
                    delete next.branch;
                    return next;
                  });
                }
              }}
            />
            {ruleErrors.branch ? (
              <p role="alert" className="ui-field__error">
                {ruleErrors.branch}
              </p>
            ) : null}
          </div>
          <div className="protection-rule-form__checks">
            <label className="protection-rule-form__check">
              <input
                type="checkbox"
                checked={ruleApproval}
                onChange={(event) => setRuleApproval(event.target.checked)}
              />
              Require 1 approval
            </label>
            <label className="protection-rule-form__check">
              <input
                type="checkbox"
                checked={ruleCheck}
                onChange={(event) => setRuleCheck(event.target.checked)}
              />
              Require status check test
            </label>
          </div>
          <div className="protection-rule-form__actions">
            <Button type="submit" variant="primary" disabled={ruleBusy}>
              {submitLabel}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setRuleFormOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
