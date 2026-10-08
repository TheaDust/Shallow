import { useState, type FormEvent } from "react";

import { navigate } from "../lib/hash-route";
import { namespaceOptions, parseNamespace } from "../lib/namespaces";
import { createRepository, fetchYourOrganizations, type RepositoryFieldErrors } from "../lib/org-api";
import { useSession } from "../lib/session";
import { useAsyncData } from "../lib/use-async";
import { Button } from "../ui/Button";
import { Combobox } from "../ui/Combobox";
import { FormField } from "../ui/FormField";

type Visibility = "public" | "private";

/**
 * Repository-creation form opened by "New repository". The signed-in user's
 * personal namespace is preselected and "Public" stays the default visibility,
 * so empty-name and duplicate-name validation can be exercised without any
 * further input. The server re-checks the namespace permission, the name
 * uniqueness and the options; a rejection keeps the form on screen and shows the
 * reason instead of opening any repository.
 */
export function NewRepositoryPage() {
  const { user } = useSession();
  const organizations = useAsyncData(() => fetchYourOrganizations(), []);
  const [owner, setOwner] = useState<string>(user ? `account:${user.id}` : "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [initialize, setInitialize] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<RepositoryFieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFieldErrors({});
    setFailure(null);
    try {
      const { ownerType, ownerId } = parseNamespace(owner);
      const result = await createRepository({
        ownerType,
        ownerId,
        name: name.trim(),
        description: description.trim(),
        visibility,
        initialize,
      });
      if (!result.ok) {
        setFieldErrors(result.fieldErrors);
        // Only a failure that has no field to attach to uses the summary line,
        // so the same reason is never rendered twice.
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
      setFailure("Unable to create the repository. Please try again.");
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <section className="page__body repository-form">
        <h1 className="repository-form__title">New repository</h1>
        <form className="repository-form__form" onSubmit={handleSubmit} noValidate>
          {failure ? (
            <p className="repository-form__error" role="alert">
              {failure}
            </p>
          ) : null}

          <div className="ui-field" data-invalid={Boolean(fieldErrors.owner) || undefined}>
            <Combobox
              id="new-repository-owner"
              label="Owner"
              options={options}
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
            />
            {fieldErrors.owner ? (
              <p className="ui-field__error" role="alert">
                {fieldErrors.owner}
              </p>
            ) : null}
          </div>

          <FormField id="new-repository-name" label="Repository name" error={fieldErrors.name}>
            <input
              id="new-repository-name"
              name="name"
              type="text"
              autoComplete="off"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>

          <FormField
            id="new-repository-description"
            label="Description"
            error={fieldErrors.description}
          >
            <textarea
              id="new-repository-description"
              name="description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </FormField>

          <fieldset className="repository-form__visibility">
            <legend>Visibility</legend>
            <label className="repository-form__choice">
              <input
                type="radio"
                name="visibility"
                value="public"
                checked={visibility === "public"}
                onChange={() => setVisibility("public")}
              />
              Public
            </label>
            <label className="repository-form__choice">
              <input
                type="radio"
                name="visibility"
                value="private"
                checked={visibility === "private"}
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

          <label className="repository-form__choice repository-form__initialize">
            <input
              type="checkbox"
              name="initialize"
              checked={initialize}
              onChange={(event) => setInitialize(event.target.checked)}
            />
            Add a README file
          </label>

          <Button type="submit" variant="primary" disabled={busy}>
            Create repository
          </Button>
        </form>
      </section>
    </main>
  );
}
