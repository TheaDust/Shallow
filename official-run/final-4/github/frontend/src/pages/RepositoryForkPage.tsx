import { useEffect, useState, type FormEvent } from "react";

import { ErrorHeading, LoadingNote } from "../components/ViewState";
import { navigate } from "../lib/hash-route";
import { namespaceOptions, parseNamespace } from "../lib/namespaces";
import { fetchRepository, fetchYourOrganizations, forkRepository, type RepositoryFieldErrors } from "../lib/org-api";
import { repositoryHash } from "../lib/routes";
import { useSession } from "../lib/session";
import { useAsyncData } from "../lib/use-async";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { FormField } from "../ui/FormField";

type Visibility = "public" | "private";

/**
 * Fork form opened by the "Fork" button of a readable repository. It defaults to
 * the signed-in user's personal namespace, the source repository name and an
 * allowed visibility, so it can be submitted after editing only the name. A
 * private source can only be forked privately; the server validates both the
 * read permission on the source and the creation permission in the target
 * namespace and writes nothing when any check fails.
 */
export function RepositoryForkPage({ owner, name }: { owner: string; name: string }) {
  const { user } = useSession();
  const source = useAsyncData(() => fetchRepository(owner, name), [owner, name]);
  const organizations = useAsyncData(() => fetchYourOrganizations(), []);
  const [ownerValue, setOwnerValue] = useState<string>(user ? `account:${user.id}` : "");
  const [forkName, setForkName] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<Visibility | null>(null);
  const [fieldErrors, setFieldErrors] = useState<RepositoryFieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!source.data) return;
    setVisibility(
      (current) => current ?? (source.data!.visibility === "private" ? "private" : "public"),
    );
  }, [source.data]);

  if (!user) {
    return (
      <main className="page">
        <section className="page__body">
          <p role="status">Loading application…</p>
        </section>
      </main>
    );
  }

  const options = namespaceOptions(user, organizations.data ?? []);
  const resolvedName = forkName ?? source.data?.name ?? "";
  const sourceIsPrivate = source.data?.visibility === "private";
  const resolvedVisibility: Visibility = sourceIsPrivate ? "private" : visibility ?? "public";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFieldErrors({});
    setFailure(null);
    try {
      const { ownerType, ownerId } = parseNamespace(ownerValue);
      const result = await forkRepository(owner, name, {
        ownerType,
        ownerId,
        name: resolvedName.trim(),
        visibility: resolvedVisibility,
      });
      if (!result.ok) {
        setFieldErrors(result.fieldErrors);
        const hasField = Object.values(result.fieldErrors).some(Boolean);
        setFailure(hasField ? null : result.message);
        setBusy(false);
        return;
      }
      setBusy(false);
      navigate(
        `/repositories/${encodeURIComponent(result.value.owner.id)}/${encodeURIComponent(result.value.name)}`,
      );
    } catch {
      setFailure("Unable to create the fork. Please try again.");
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <section className="page__body repository-form">
        <h1 className="repository-form__title">Create a fork</h1>
        {source.status === "loading" ? <LoadingNote label="Loading repository…" /> : null}
        {source.status === "error" && source.error ? <ErrorHeading error={source.error} /> : null}
        {source.status === "ready" && source.data ? (
          <>
            <p className="repository-form__lead">
              An independent copy of{" "}
              <a href={repositoryHash(source.data.owner.id, source.data.name)}>{source.data.name}</a>.
            </p>
            <form className="repository-form__form" onSubmit={handleSubmit} noValidate>
              {failure ? (
                <p className="repository-form__error" role="alert">
                  {failure}
                </p>
              ) : null}

              <div className="ui-field" data-invalid={Boolean(fieldErrors.owner) || undefined}>
                <Combobox
                  id="fork-owner"
                  label="Owner"
                  options={options}
                  value={ownerValue}
                  onChange={(event) => setOwnerValue(event.target.value)}
                />
                {fieldErrors.owner ? (
                  <p className="ui-field__error" role="alert">
                    {fieldErrors.owner}
                  </p>
                ) : null}
              </div>

              <FormField id="fork-repository-name" label="Repository name" error={fieldErrors.name}>
                <input
                  id="fork-repository-name"
                  name="name"
                  type="text"
                  autoComplete="off"
                  value={resolvedName}
                  onChange={(event) => setForkName(event.target.value)}
                />
              </FormField>

              <fieldset className="repository-form__visibility">
                <legend>Visibility</legend>
                <label className="repository-form__choice">
                  <input
                    type="radio"
                    name="visibility"
                    value="public"
                    checked={resolvedVisibility === "public"}
                    disabled={sourceIsPrivate}
                    onChange={() => setVisibility("public")}
                  />
                  Public
                </label>
                <label className="repository-form__choice">
                  <input
                    type="radio"
                    name="visibility"
                    value="private"
                    checked={resolvedVisibility === "private"}
                    onChange={() => setVisibility("private")}
                  />
                  Private
                </label>
                {fieldErrors.visibility ? (
                  <p className="repository-form__error" role="alert">
                    {fieldErrors.visibility}
                  </p>
                ) : null}
              </fieldset>

              <Button type="submit" variant="primary" disabled={busy}>
                Create fork
              </Button>
            </form>
          </>
        ) : null}
      </section>
    </main>
  );
}
