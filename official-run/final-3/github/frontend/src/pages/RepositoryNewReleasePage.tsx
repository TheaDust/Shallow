import { useState, type FormEvent } from "react";

import { AppHeader } from "../components/AppHeader";
import { RepositoryBreadcrumb } from "../components/RepositoryBreadcrumb";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { navigate } from "../lib/hash-route";
import {
  createRepositoryRelease,
  fetchRepository,
  fetchRepositoryBranches,
  type ReleaseFieldErrors,
} from "../lib/org-api";
import { repositoryReleasesHash } from "../lib/routes";
import { useAsyncData } from "../lib/use-async";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { FormField } from "../ui/FormField";

/**
 * New release form (REQ-4-5): the visible `Tag name`, `Release title`,
 * `Description` and `Target branch` fields and the `Publish release` button. The
 * target branch is one of the existing branches. A valid submission opens the
 * stored release detail; an existing tag stays on the form with the exact
 * `Tag already exists` message and creates nothing. Only a writer may reach the
 * form, which the server re-checks.
 */
export function RepositoryNewReleasePage({ owner, name }: { owner: string; name: string }) {
  const repository = useAsyncData(() => fetchRepository(owner, name), [owner, name]);
  const branches = useAsyncData(() => fetchRepositoryBranches(owner, name), [owner, name]);
  const [tag, setTag] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetBranch, setTargetBranch] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ReleaseFieldErrors>({});
  const [busy, setBusy] = useState(false);
  const view = repository.data;
  const branchNames = (branches.data?.branches ?? []).map((branch) => branch.name);
  const selectedBranch = targetBranch || view?.defaultBranch || branchNames[0] || "";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFieldErrors({});
    const result = await createRepositoryRelease(owner, name, {
      tag,
      title,
      description,
      targetBranch: selectedBranch,
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
        {view ? <RepositoryBreadcrumb repository={view} /> : null}
        <h1 className="repository-new-release__title">New release</h1>
        {repository.status === "loading" && !view ? <LoadingNote label="Loading repository…" /> : null}
        {repository.status === "error" && repository.error ? (
          <ErrorHeading error={repository.error} />
        ) : null}
        {view && !view.canWrite ? <ErrorHeading error={{ message: "Access denied", status: 403 }} /> : null}
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
              <FormField id="release-description" label="Description">
                <textarea
                  id="release-description"
                  name="description"
                  rows={6}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </FormField>
              <FormField id="release-branch" label="Target branch" error={fieldErrors.targetBranch}>
                <Combobox
                  id="release-branch"
                  label="Target branch"
                  labelHidden
                  aria-label="Target branch"
                  options={branchNames.map((branch) => ({ value: branch, label: branch }))}
                  value={selectedBranch}
                  onChange={(event) => setTargetBranch(event.currentTarget.value)}
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
