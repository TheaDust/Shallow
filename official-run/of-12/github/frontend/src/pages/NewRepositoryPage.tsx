import { useState, type FormEvent } from "react";

import { Button, FormField } from "../ui";
import { navigate } from "../lib/hash-route";
import { readFormChecked, readFormValues } from "../lib/forms";
import { useSession } from "../lib/session";
import { createRepository } from "../features/repositories/repository-api";

const FIELD_IDS = {
  owner: "repository-owner",
  name: "repository-name",
  description: "repository-description",
};

/**
 * Repository-creation page reached from the workspace "New repository" link
 * (REQ-3-2-1).
 *
 * The signed-in account's personal namespace is selected by default, so the
 * form can be submitted without touching the Owner field; the visibility radio
 * group and the initialization checkbox carry defaults too. The server owns
 * every rule (namespace permission, name uniqueness, options) and returns the
 * field messages rendered beside the matching control, so a rejected creation
 * stays on the form and leaves no repository behind.
 */
export function NewRepositoryPage() {
  const { user, loading } = useSession();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const owners = user
    ? [
        { value: user.username, label: user.username },
        ...user.organizations
          .filter((organization) => organization.role === "Owner")
          .map((organization) => ({ value: organization.name, label: organization.name })),
      ]
    : [];

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = readFormValues(form, ["owner", "name", "description", "visibility"]);
    const initialize = readFormChecked(form, "initialize");
    setErrors({});
    setMessage(null);
    setSubmitting(true);
    const result = await createRepository({
      owner: values.owner ?? "",
      name: values.name ?? "",
      description: values.description ?? "",
      visibility: values.visibility === "private" ? "private" : "public",
      initialize,
    });
    setSubmitting(false);
    if (!result.ok) {
      setErrors(result.errors);
      // A field error is already announced next to its input; only an error
      // without a field renders the form-level alert, so one reason is shown.
      setMessage(result.errors.name || result.errors.owner ? null : result.message);
      return;
    }
    navigate(`/${result.data.owner}/${result.data.name}`);
  };

  return (
    <main className="new-repository-page">
      <h1>Create a new repository</h1>
      <p className="new-repository-page__lead">
        A repository contains all of your project files and each of its revisions. Choose the owner
        and visibility, then open it from its overview page.
      </p>
      {loading ? <p role="status">Loading…</p> : null}
      {!loading && !user ? (
        <p className="new-repository-page__signed-out">
          You need to sign in to create a repository. <a href="#/sign-in">Sign in</a>
        </p>
      ) : null}
      {user ? (
        <form className="repository-form" onSubmit={onSubmit} noValidate>
          <FormField id={FIELD_IDS.owner} label="Owner" error={errors.owner}>
            <select id={FIELD_IDS.owner} name="owner" defaultValue={user.username}>
              {owners.map((owner) => (
                <option key={owner.value} value={owner.value}>
                  {owner.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id={FIELD_IDS.name} label="Repository name" error={errors.name}>
            <input id={FIELD_IDS.name} name="name" type="text" autoComplete="off" />
          </FormField>
          <FormField id={FIELD_IDS.description} label="Description">
            <input id={FIELD_IDS.description} name="description" type="text" autoComplete="off" />
          </FormField>

          <fieldset className="repository-form__group">
            <legend>Visibility</legend>
            <label className="repository-form__choice">
              <input type="radio" name="visibility" value="public" defaultChecked /> Public
            </label>
            <label className="repository-form__choice">
              <input type="radio" name="visibility" value="private" /> Private
            </label>
          </fieldset>

          <label className="repository-form__choice">
            <input type="checkbox" name="initialize" /> Add a README file
          </label>

          {message ? (
            <p className="repository-form__error" role="alert">
              {message}
            </p>
          ) : null}
          <Button type="submit" variant="primary" disabled={submitting}>
            Create repository
          </Button>
        </form>
      ) : null}
    </main>
  );
}
