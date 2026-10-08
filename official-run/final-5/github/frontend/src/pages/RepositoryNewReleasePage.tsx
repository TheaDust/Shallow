import { useState, type FormEvent } from "react";

import { RepositoryBreadcrumb } from "../components/RepositoryBreadcrumb";
import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { ApiError } from "../lib/api";
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
 * Form that publishes one release (REQ-4-5). "Tag name", "Release title",
 * "Description" and "Target branch" describe the release and "Publish release"
 * stores it; the target branch lists the existing branch names only. A tag the
 * repository already uses is reported as "Tag already exists" and creates no
 * second release, so the form stays open with the entered values.
 */
export function RepositoryNewReleasePage({ owner, name }: { owner: string; name: string }) {
  const repository = useAsyncData(() => fetchRepository(owner, name), [owner, name]);
  const branches = useAsyncData(() => fetchRepositoryBranches(owner, name), [owner, name]);
  const [tagName, setTagName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [targetBranch, setTargetBranch] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ReleaseFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const branchNames = branches.data?.branches ?? [];
  const selectedBranch = targetBranch || branches.data?.defaultBranch || "";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFieldErrors({});
    setFormError(null);
    try {
      const result = await createRepositoryRelease(owner, name, {
        tagName,
        title,
        description,
        targetBranch: selectedBranch,
      });
      if (!result.ok) {
        setFieldErrors(result.fieldErrors);
        if (Object.keys(result.fieldErrors).length === 0) setFormError(result.message);
        setSaving(false);
        return;
      }
      navigate(
        `/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/releases/${encodeURIComponent(
          result.value.tagName,
        )}`,
      );
    } catch (caught) {
      setFormError(
        caught instanceof ApiError ? caught.message : "Unable to publish the release. Please try again.",
      );
      setSaving(false);
    }
  };

  const ready = repository.data !== null && branches.data !== null;

  return (
    <main className="page">
      <section className="page__body repository-new-release">
        {repository.data ? <RepositoryBreadcrumb repository={repository.data} /> : null}
        <h1 className="repository-new-release__title">New release</h1>
        {!ready ? <LoadingNote label="Loading repository…" /> : null}
        {repository.status === "error" && repository.error ? (
          <ErrorHeading error={repository.error} />
        ) : null}
        {repository.status === "ready" && branches.status === "error" && branches.error ? (
          <ErrorHeading error={branches.error} />
        ) : null}
        {ready ? (
          repository.data?.canWrite ? (
            <form className="repository-new-release__form" onSubmit={submit} noValidate>
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
                  rows={8}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </FormField>
              <FormField id="release-target-branch" label="Target branch" error={fieldErrors.targetBranch}>
                <Combobox
                  id="release-target-branch"
                  label="Target branch"
                  labelHidden
                  name="targetBranch"
                  value={selectedBranch}
                  options={branchNames.map((branch) => ({ value: branch.name, label: branch.name }))}
                  onChange={(event) => setTargetBranch(event.currentTarget.value)}
                />
              </FormField>
              <Button type="submit" variant="primary" disabled={saving}>
                Publish release
              </Button>
              {formError ? (
                <p className="repository-new-release__error" role="alert">
                  {formError}
                </p>
              ) : null}
            </form>
          ) : (
            <p className="repository-new-release__hint">
              You need write permission on this repository to publish a release.
            </p>
          )
        ) : null}
        {repository.data ? (
          <p className="repository-new-release__back">
            <a href={repositoryReleasesHash(repository.data.owner.id, repository.data.name)}>
              Releases
            </a>
          </p>
        ) : null}
      </section>
    </main>
  );
}
