import { FormEvent, useState } from "react";

import { navigate } from "../../lib/hash-route";
import { createIssue, IssueFieldErrors } from "../../lib/issue-api";
import { repoOwnerBase, RepoOwnerType } from "../../lib/repo-api";
import { useSession } from "../../session";
import { RepoPageChrome } from "../repos/RepoPageChrome";
import { useRepoDetail } from "../repos/useRepoDetail";

interface NewIssuePageProps {
  ownerType: RepoOwnerType;
  ownerName: string;
  repoName: string;
}

/**
 * The issue creation form opened by the “New issue” link on the Issues page
 * (REQ-5-2-1). Only Write, Maintain, or Admin may create. The title must be
 * 1–256 characters after trimming (a whitespace-only title shows “Title is
 * required” and creates nothing); the description is optional. On success
 * the new issue's detail page opens.
 */
export function NewIssuePage({ ownerType, ownerName, repoName }: NewIssuePageProps) {
  const { status: sessionStatus } = useSession();
  const { status: detailStatus, repository } = useRepoDetail(ownerType, ownerName, repoName);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<IssueFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const base = `${repoOwnerBase(ownerType, ownerName)}/repos/${encodeURIComponent(repoName)}`;
  const canCreate =
    sessionStatus === "authenticated" &&
    ["write", "maintain", "admin"].includes(repository?.currentRole ?? "");

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const nextErrors: IssueFieldErrors = {};
    if (!title.trim()) {
      nextErrors.title = "Title is required";
    }
    if (description.length > 65536) {
      nextErrors.description = "Description must be at most 65536 characters";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSubmitting(true);
    const outcome = await createIssue(ownerType, ownerName, repoName, { title, description });
    setSubmitting(false);
    if (!outcome.ok) {
      setErrors(outcome.errors);
      return;
    }
    navigate(`${base}/issues/${outcome.issue.number}`, undefined);
  }

  if (sessionStatus !== "authenticated") {
    return (
      <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName} section="issues">
        <p>Sign in to create an issue.</p>
        <p>
          <a href="#/signin">Sign in</a>
        </p>
      </RepoPageChrome>
    );
  }
  if (detailStatus === "notfound") {
    return (
      <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName} section="issues">
        <p>Repository not found.</p>
      </RepoPageChrome>
    );
  }
  if (detailStatus === "denied") {
    return (
      <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName} section="issues">
        <p>Access denied</p>
      </RepoPageChrome>
    );
  }
  if (detailStatus !== "ready" || !repository) {
    return (
      <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName} section="issues">
        <p>Loading…</p>
      </RepoPageChrome>
    );
  }
  if (!canCreate) {
    return (
      <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName} section="issues">
        <p>You need write permission to create an issue.</p>
      </RepoPageChrome>
    );
  }

  return (
    <RepoPageChrome ownerType={ownerType} ownerName={ownerName} repoName={repoName} section="issues">
      <h2>New issue</h2>
      <form className="new-issue" onSubmit={(event) => void onSubmit(event)}>
        <div className="new-issue__field">
          <label htmlFor="issue-title">Title</label>
          <input
            id="issue-title"
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? "issue-title-error" : undefined}
          />
          {errors.title && (
            <p id="issue-title-error" className="field-error" role="alert">
              {errors.title}
            </p>
          )}
        </div>
        <div className="new-issue__field">
          <label htmlFor="issue-description">Description</label>
          <textarea
            id="issue-description"
            rows={6}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            aria-invalid={Boolean(errors.description)}
            aria-describedby={errors.description ? "issue-description-error" : undefined}
          />
          {errors.description && (
            <p id="issue-description-error" className="field-error" role="alert">
              {errors.description}
            </p>
          )}
        </div>
        <button type="submit" className="button button--primary" disabled={submitting}>
          {submitting ? "Submitting…" : "Submit new issue"}
        </button>
      </form>
    </RepoPageChrome>
  );
}
