import { useEffect, useState, type FormEvent } from "react";

import { AppHeader } from "../components/AppHeader";
import { RepositoryBreadcrumb } from "../components/RepositoryBreadcrumb";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { navigate } from "../lib/hash-route";
import {
  createRepositoryRelease,
  fetchRepositoryBranches,
  type ReleaseFieldErrors,
} from "../lib/org-api";
import { repositoryReleasesHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { FormField } from "../ui/FormField";

/**
 * The `New release` form (REQ-4-5) opened from the Releases page: the visible
 * `Tag name`, `Release title`, `Description` and `Target branch` fields and the
 * `Publish release` button. The target branch is chosen among the existing
 * branches of the repository; a valid submission stores the release and opens
 * its detail, while a rejected one (for instance the already used tag
 * `Tag already exists`) stays on the form and publishes nothing.
 */
export function RepositoryNewReleasePage({ owner, name }: { owner: string; name: string }) {
  const branches = useAsyncData(() => fetchRepositoryBranches(owner, name), [owner, name]);
  const [tagName, setTagName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetBranch, setTargetBranch] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ReleaseFieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const view = branches.data;

  // The selection starts on the repository default branch, so publishing only
  // needs the tag, the title and the description.
  useEffect(() => {
    if (!view) return;
    setTargetBranch((current) => current || view.defaultBranch);
  }, [view]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFieldErrors({});
    setMessage(null);
    const result = await createRepositoryRelease(owner, name, {
      tagName,
      title,
      description,
      targetBranch,
    });
    setBusy(false);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors);
      setMessage(Object.keys(result.fieldErrors).length === 0 ? result.message : null);
      return;
    }
    navigate(
      `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/releases/${encodeURIComponent(
        result.value.release.tagName,
      )}`,
    );
  };

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body repository-new-release">
        {view ? <RepositoryBreadcrumb repository={view.repository} /> : null}
        <h1 className="repository-new-release__title">New release</h1>
        {branches.status === "loading" && !view ? <LoadingNote label="Loading branches…" /> : null}
        {branches.status === "error" && branches.error ? (
          <ErrorHeading error={branches.error} />
        ) : null}
        {view && !view.canWrite ? (
          <ErrorHeading error={{ message: "Access denied", status: 403 }} />
        ) : null}
        {view && view.canWrite ? (
          <>
            <p className="repository-new-release__back">
              <a href={repositoryReleasesHash(owner, name)}>Releases</a>
            </p>
            <form className="repository-new-release__form" onSubmit={submit}>
              <FormField id="release-tag" label="Tag name" error={fieldErrors.tagName}>
                <input
                  id="release-tag"
                  name="tagName"
                  type="text"
                  value={tagName}
                  onChange={(event) => setTagName(event.target.value)}
                />
              </FormField>
              <FormField id="release-title" label="Release title" error={fieldErrors.title}>
                <input
                  id="release-title"
                  name="title"
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </FormField>
              <FormField id="release-description" label="Description" error={fieldErrors.description}>
                <textarea
                  id="release-description"
                  name="description"
                  rows={6}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </FormField>
              <FormField
                id="release-target-branch"
                label="Target branch"
                error={fieldErrors.targetBranch}
              >
                <Combobox
                  id="release-target-branch"
                  name="targetBranch"
                  label="Target branch"
                  labelHidden
                  options={view.branches.map((branch) => ({
                    value: branch.name,
                    label: branch.name,
                  }))}
                  value={targetBranch}
                  onChange={(event) => setTargetBranch(event.currentTarget.value)}
                />
              </FormField>
              {message ? (
                <p className="repository-new-release__error" role="alert">
                  {message}
                </p>
              ) : null}
              <Button type="submit" variant="primary" disabled={busy}>
                Publish release
              </Button>
            </form>
          </>
        ) : null}
      </section>
    </main>
  );
}
