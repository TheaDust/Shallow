import { useState, type FormEvent } from "react";

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
 * Release form (REQ-4-5): the fields `Tag name`, `Release title`, `Description`
 * and `Target branch` plus the `Publish release` button. The target branch is
 * selected from the branches the repository already has. A valid submission
 * opens the stored release detail; a published tag is refused with
 * `Tag already exists` and creates no second release. Only a writer reaches the
 * form, which the server re-checks on every publish.
 */
export function RepositoryNewReleasePage({ owner, name }: { owner: string; name: string }) {
  const branches = useAsyncData(() => fetchRepositoryBranches(owner, name), [owner, name]);
  const [tag, setTag] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [branch, setBranch] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ReleaseFieldErrors>({});
  const [busy, setBusy] = useState(false);
  const view = branches.data;
  const branchNames = view ? view.branches.map((entry) => entry.name) : [];
  const selectedBranch = branch || view?.defaultBranch || "";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFieldErrors({});
    const result = await createRepositoryRelease(owner, name, {
      tag,
      title,
      description,
      branch: selectedBranch,
    });
    setBusy(false);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors);
      return;
    }
    navigate(
      `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/releases/${encodeURIComponent(
        result.value.release.tag,
      )}`,
    );
  };

  return (
    <main className="page">
      <AppHeader />
      <section className="page__body repository-new-release">
        {view ? <RepositoryBreadcrumb repository={view.repository} /> : null}
        <h1 className="repository-new-release__title">New release</h1>
        {branches.status === "loading" && !view ? (
          <LoadingNote label="Loading branches…" />
        ) : null}
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
              <FormField id="release-tag" label="Tag name" error={fieldErrors.tag}>
                <input
                  id="release-tag"
                  name="tag"
                  type="text"
                  value={tag}
                  onChange={(event) => setTag(event.target.value)}
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
              <FormField id="release-branch" label="Target branch" error={fieldErrors.branch}>
                <Combobox
                  id="release-branch"
                  label="Target branch"
                  labelHidden
                  options={branchNames.map((value) => ({ value, label: value }))}
                  value={selectedBranch}
                  onChange={(event) => setBranch(event.currentTarget.value)}
                />
              </FormField>
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
