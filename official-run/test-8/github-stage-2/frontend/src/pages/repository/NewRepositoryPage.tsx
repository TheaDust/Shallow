import { useState, type FormEvent } from "react";

import { fieldErrorsOf, messageOf, type Account, type FieldErrors } from "../../api/auth";
import { createRepository, type RepositoryVisibility } from "../../api/organizations";
import { RepositoryOwnerField, RepositoryVisibilityField } from "../../components/RepositoryForm";
import { SiteHeader } from "../../components/SiteHeader";
import { navigate } from "../../lib/hash-route";
import { Button, FormField } from "../../ui";

/**
 * “New repository”, reached from the signed-in workspace.
 *
 * The personal namespace is selected by default, so the form submits without
 * changing the owner; visibility defaults to Public and the README checkbox to
 * unchecked, so the name is the only field a scenario has to fill in. Both the
 * required-name and the duplicate-name rejection are answered by the server,
 * which is also where the namespace permission is decided.
 */
export function NewRepositoryPage({ account }: { account: Account }) {
  const [owner, setOwner] = useState(account.username);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<RepositoryVisibility>("public");
  const [initialize, setInitialize] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      const result = await createRepository({ owner, name, description, visibility, initialize });
      navigate(`/repositories/${result.repository.owner?.login ?? owner}/${result.repository.name}`);
    } catch (error) {
      const fields = fieldErrorsOf(error);
      if (Object.keys(fields).length > 0) setErrors(fields);
      else setFormError(messageOf(error, "Repository creation failed"));
    } finally {
      setPending(false);
    }
  };

  return (
    <main>
      <SiteHeader account={account} />
      <h1>New repository</h1>
      <form
        className="account-form"
        aria-label="New repository"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <RepositoryOwnerField account={account} value={owner} onChange={setOwner} />
        {errors.owner ? (
          <p className="form-error" role="alert">
            {errors.owner}
          </p>
        ) : null}
        <FormField id="repository-name" label="Repository name" error={errors.name}>
          <input
            id="repository-name"
            name="repositoryName"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField id="repository-description" label="Description">
          <input
            id="repository-description"
            name="description"
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormField>
        <RepositoryVisibilityField value={visibility} onChange={setVisibility} />
        {errors.visibility ? (
          <p className="form-error" role="alert">
            {errors.visibility}
          </p>
        ) : null}
        <FormField id="repository-readme" label="Add a README file">
          <input
            id="repository-readme"
            name="addReadme"
            type="checkbox"
            checked={initialize}
            onChange={(event) => setInitialize(event.target.checked)}
          />
        </FormField>
        {formError ? (
          <p className="form-error" role="alert">
            {formError}
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={pending}>
          Create repository
        </Button>
      </form>
    </main>
  );
}
