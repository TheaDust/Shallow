import { useState, type FormEvent } from "react";

import { AppHeader } from "../components/AppHeader";
import { RepositoryBreadcrumb } from "../components/RepositoryBreadcrumb";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { navigate } from "../lib/hash-route";
import { createRepositoryIssue, fetchRepository, type IssueFieldErrors } from "../lib/org-api";
import { repositoryIssuesHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";
import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";

/**
 * New issue form (REQ-5-2-1): the fields `Title` and `Description` and the
 * `Submit new issue` button. A valid submission opens the stored issue; a
 * rejected one stays on the form with the required-field message and creates
 * nothing. Only a writer may reach the form, which the server re-checks.
 */
export function RepositoryNewIssuePage({ owner, name }: { owner: string; name: string }) {
  const repository = useAsyncData(() => fetchRepository(owner, name), [owner, name]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fieldErrors, setFieldErrors] = useState<IssueFieldErrors>({});
  const [busy, setBusy] = useState(false);
  const view = repository.data;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFieldErrors({});
    const result = await createRepositoryIssue(owner, name, { title, description });
    setBusy(false);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors);
      return;
    }
    navigate(
      `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${encodeURIComponent(
        String(result.value.issue.number),
      )}`,
    );
  };

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body repository-new-issue">
        {view ? <RepositoryBreadcrumb repository={view} /> : null}
        <h1 className="repository-new-issue__title">New issue</h1>
        {repository.status === "loading" && !view ? <LoadingNote label="Loading repository…" /> : null}
        {repository.status === "error" && repository.error ? (
          <ErrorHeading error={repository.error} />
        ) : null}
        {view && !view.canWrite ? <ErrorHeading error={{ message: "Access denied", status: 403 }} /> : null}
        {view && view.canWrite ? (
          <>
            <p className="repository-new-issue__back">
              <a href={repositoryIssuesHash(owner, name)}>Issues</a>
            </p>
            <form className="repository-new-issue__form" onSubmit={submit}>
              <FormField id="issue-title" label="Title" error={fieldErrors.title}>
                <input
                  id="issue-title"
                  name="title"
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </FormField>
              <FormField id="issue-description" label="Description" error={fieldErrors.description}>
                <textarea
                  id="issue-description"
                  name="description"
                  rows={6}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </FormField>
              <Button type="submit" variant="primary" disabled={busy}>
                Submit new issue
              </Button>
            </form>
          </>
        ) : null}
      </section>
    </main>
  );
}
