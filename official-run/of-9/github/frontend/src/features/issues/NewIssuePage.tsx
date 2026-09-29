import { useEffect, useState, type FormEvent } from "react";

import { ApiError } from "../../lib/api";
import { navigate } from "../../lib/hash-route";
import { useSession } from "../auth/session";
import { AccessDenied } from "../organizations/AccessDenied";
import { getRepository, type RepoRole } from "../organizations/api";
import { Button } from "../../ui";
import { createIssue } from "./api";
import { RepoNav } from "./RepoNav";

const WRITABLE_ROLES: RepoRole[] = ["write", "maintain", "admin"];

export function NewIssuePage({ owner, name }: { owner: string; name: string }) {
  const { session } = useSession();
  const [role, setRole] = useState<RepoRole | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "denied" | "missing">("loading");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<{ title?: string; description?: string; general?: string }>(
    {},
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (session.status !== "authenticated") {
      setStatus("denied");
      return;
    }
    setStatus("loading");
    getRepository(owner, name)
      .then((repo) => {
        if (cancelled) return;
        setRole(repo.myRole);
        setStatus("ok");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 403) setStatus("denied");
        else setStatus("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [owner, name, session.status]);

  if (status === "denied") return <AccessDenied />;
  if (status === "missing") {
    return (
      <section className="issue-new">
        <RepoNav owner={owner} name={name} active="issues" />
        <h1>New issue</h1>
        <p className="issue-new__empty">Repository not found</p>
      </section>
    );
  }
  if (status === "loading") {
    return (
      <p role="status" className="page-status">
        Loading…
      </p>
    );
  }

  const allowed = role !== null && WRITABLE_ROLES.includes(role);
  if (!allowed) return <AccessDenied />;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrors({});
    setSubmitting(true);
    const result = await createIssue(owner, name, { title, description });
    setSubmitting(false);
    if (result.ok) {
      navigate(`/repos/${owner}/${name}/issues/${result.issue.number}`);
    } else {
      setErrors(result.errors);
    }
  };

  return (
    <section className="issue-new">
      <RepoNav owner={owner} name={name} active="issues" />
      <h1>New issue</h1>
      <form className="issue-new__form" onSubmit={submit}>
        <div className="ui-field" data-invalid={Boolean(errors.title) || undefined}>
          <label htmlFor="issue-new-title">Title</label>
          <input
            id="issue-new-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          {errors.title ? (
            <p id="issue-new-title-error" className="ui-field__error" role="alert">
              {errors.title}
            </p>
          ) : null}
        </div>
        <div className="ui-field" data-invalid={Boolean(errors.description) || undefined}>
          <label htmlFor="issue-new-description">Description</label>
          <textarea
            id="issue-new-description"
            rows={6}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          {errors.description ? (
            <p id="issue-new-description-error" className="ui-field__error" role="alert">
              {errors.description}
            </p>
          ) : null}
        </div>
        {errors.general ? (
          <p className="ui-field__error" role="alert">
            {errors.general}
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={submitting}>
          Submit new issue
        </Button>
      </form>
    </section>
  );
}
