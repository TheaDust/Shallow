import { useEffect, useState, type FormEvent } from "react";

import { navigate } from "../../lib/hash-route";
import { Button, FormField } from "../../ui";
import { useSession } from "../auth/session";
import {
  createRepository,
  listOrganizations,
  type FieldErrors,
  type Visibility,
} from "./api";

// Repository-creation page opened from the signed-in workspace "New repository"
// link. The signed-in user's personal namespace is selected by default;
// organizations where the user is an Owner are also selectable.
export function NewRepositoryPage() {
  const { session } = useSession();
  const username = session.status === "authenticated" ? session.account.username : null;
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [owner, setOwner] = useState(username ?? "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [initialize, setInitialize] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!username) return;
    setOwner(username);
    setNamespaces([username]);
    listOrganizations()
      .then((organizations) => {
        const creatable = organizations
          .filter((organization) => organization.role === "owner")
          .map((organization) => organization.id);
        setNamespaces((current) => [...new Set([...current, ...creatable])]);
      })
      .catch(() => {
        // Keep the personal namespace; creation there must remain possible.
      });
  }, [username]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !username) return;
    setBusy(true);
    setErrors({});
    try {
      const result = await createRepository({
        owner,
        name: name.trim(),
        description: description.trim(),
        visibility,
        initialize,
      });
      if (result.ok) {
        navigate(`/repos/${result.repository.owner}/${result.repository.name}`);
      } else {
        setErrors(result.errors);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="repo-form-page">
      <h1>New repository</h1>
      <form className="repo-form" onSubmit={submit} noValidate>
        <FormField id="new-repo-owner" label="Owner" error={errors.owner}>
          <select
            id="new-repo-owner"
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
          >
            {namespaces.map((namespace) => (
              <option key={namespace} value={namespace}>
                {namespace}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="new-repo-name" label="Repository name" error={errors.name}>
          <input
            id="new-repo-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField id="new-repo-description" label="Description" error={errors.description}>
          <input
            id="new-repo-description"
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormField>
        <fieldset className="repo-form__visibility">
          <legend>Visibility</legend>
          <label>
            <input
              type="radio"
              name="new-repo-visibility"
              value="public"
              checked={visibility === "public"}
              onChange={() => setVisibility("public")}
            />
            Public
          </label>
          <label>
            <input
              type="radio"
              name="new-repo-visibility"
              value="private"
              checked={visibility === "private"}
              onChange={() => setVisibility("private")}
            />
            Private
          </label>
        </fieldset>
        {errors.visibility ? (
          <p role="alert" className="ui-field__error">
            {errors.visibility}
          </p>
        ) : null}
        <label className="repo-form__initialize">
          <input
            type="checkbox"
            checked={initialize}
            onChange={(event) => setInitialize(event.target.checked)}
          />
          Add a README file
        </label>
        {errors.general ? (
          <p role="alert" className="ui-field__error">
            {errors.general}
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={busy}>
          Create repository
        </Button>
      </form>
    </section>
  );
}
