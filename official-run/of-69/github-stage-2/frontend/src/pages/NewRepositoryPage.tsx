import { useEffect, useState, type FormEvent } from "react";

import { AppHeader } from "../components/AppHeader";
import { apiFieldErrors } from "../lib/api";
import { navigate } from "../lib/hash-route";
import { createRepository, fetchMyOrganizations } from "../lib/organization-api";
import { buildOwnerOptions, type OwnerOption } from "../lib/repository-owners";
import { repositoryPath } from "../lib/routes";
import type { Account } from "../lib/session-api";
import { apiErrorMessage, useAsyncData } from "../lib/use-async-data";
import { Button, Combobox, FormField } from "../ui";

type Visibility = "public" | "private";
type FieldErrors = { name?: string; owner?: string; visibility?: string };

function encodeOwner(owner: OwnerOption): string {
  return `${owner.type}:${owner.name}`;
}

/**
 * Repository creation form. The Owner selector defaults to the signed-in
 * user's personal namespace, the visibility defaults to Public and the README
 * initialization is opt-in, so duplicate-name and empty-name validation work
 * without any further input. A successful creation opens the new repository
 * overview.
 */
export function NewRepositoryPage({ account }: { account: Account }) {
  const organizations = useAsyncData(fetchMyOrganizations, [account.id]);
  const owners = organizations.data ? buildOwnerOptions(account.username, organizations.data) : [];
  const [ownerValue, setOwnerValue] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [initialize, setInitialize] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ownerValue || owners.length === 0) return;
    const personal = owners.find((owner) => owner.type === "user") ?? owners[0];
    setOwnerValue(encodeOwner(personal));
  }, [owners, ownerValue]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    const [ownerType, ownerName] = ownerValue.split(":");
    try {
      const result = await createRepository({
        ownerType: ownerType === "user" ? "user" : "organization",
        ownerName,
        name,
        description,
        visibility,
        initialize,
      });
      navigate(repositoryPath(result.owner, result.repository.name));
    } catch (caught) {
      const fieldErrors = apiFieldErrors(caught) as FieldErrors;
      setErrors(fieldErrors);
      if (Object.keys(fieldErrors).length === 0) {
        setFormError(apiErrorMessage(caught, "Unable to create the repository."));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <AppHeader username={account.username} />
      <main>
        <h1>New repository</h1>
        {formError ? (
          <p className="form-error" role="alert">
            {formError}
          </p>
        ) : null}
        <form className="auth-form" noValidate onSubmit={handleSubmit}>
          <Combobox
            id="repository-owner"
            label="Owner"
            value={ownerValue}
            options={owners.map((owner) => ({ value: encodeOwner(owner), label: owner.displayName }))}
            onChange={(event) => setOwnerValue(event.target.value)}
          />
          <FormField id="repository-name" label="Repository name" error={errors.name}>
            <input
              id="repository-name"
              name="name"
              type="text"
              autoComplete="off"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <FormField id="repository-description" label="Description">
            <textarea
              id="repository-description"
              name="description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </FormField>
          <fieldset className="visibility-choice">
            <legend>Visibility</legend>
            <label className="visibility-choice__option">
              <input
                type="radio"
                name="visibility"
                value="public"
                checked={visibility === "public"}
                onChange={() => setVisibility("public")}
              />
              Public
            </label>
            <label className="visibility-choice__option">
              <input
                type="radio"
                name="visibility"
                value="private"
                checked={visibility === "private"}
                onChange={() => setVisibility("private")}
              />
              Private
            </label>
          </fieldset>
          {errors.owner || errors.visibility ? (
            <p className="form-error" role="alert">
              {errors.owner ?? errors.visibility}
            </p>
          ) : null}
          <div className="ui-field">
            <label className="visibility-choice__option">
              <input
                type="checkbox"
                name="initialize"
                checked={initialize}
                onChange={(event) => setInitialize(event.target.checked)}
              />
              Add a README file
            </label>
          </div>
          <Button type="submit" variant="primary" disabled={busy || !ownerValue}>
            Create repository
          </Button>
        </form>
      </main>
    </div>
  );
}
