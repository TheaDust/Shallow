import { useState, type FormEvent } from "react";

import { navigate } from "../../lib/hash-route";
import { Button, Dialog, FormField } from "../../ui";
import { useSession } from "../auth/session";
import {
  forkRepository,
  listOrganizations,
  type FieldErrors,
  type Visibility,
} from "./api";

export function ForkDialog({
  repository,
}: {
  repository: { owner: string; name: string; visibility: Visibility };
}) {
  const { session } = useSession();
  const username = session.status === "authenticated" ? session.account.username : null;
  const [open, setOpen] = useState(false);
  const [namespaces, setNamespaces] = useState<string[] | null>(null);
  const [targetOwner, setTargetOwner] = useState("");
  const [name, setName] = useState(repository.name);
  const [visibility, setVisibility] = useState<Visibility>(repository.visibility);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const openDialog = async () => {
    setTargetOwner(username ?? "");
    setName(repository.name);
    setVisibility(repository.visibility);
    setErrors({});
    setNamespaces(null);
    setOpen(true);
    try {
      const organizations = await listOrganizations();
      setNamespaces([
        username ?? "",
        ...organizations
          .filter((organization) => organization.role === "owner")
          .map((organization) => organization.id),
      ]);
    } catch {
      setNamespaces(username ? [username] : []);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !username) return;
    setBusy(true);
    setErrors({});
    try {
      const result = await forkRepository(repository.owner, repository.name, {
        targetOwner,
        name: name.trim(),
        visibility,
      });
      if (result.ok) {
        setOpen(false);
        navigate(`/repos/${result.repository.owner}/${result.repository.name}`);
      } else {
        setErrors(result.errors);
      }
    } finally {
      setBusy(false);
    }
  };

  const privateSource = repository.visibility === "private";

  return (
    <>
      <Button variant="secondary" onClick={() => void openDialog()}>
        Fork
      </Button>
      <Dialog open={open} title="Fork repository" onOpenChange={setOpen}>
        <form className="fork-form" aria-label="Fork repository" onSubmit={submit} noValidate>
          <FormField id="fork-owner" label="Owner">
            <select
              id="fork-owner"
              value={targetOwner}
              disabled={namespaces === null}
              onChange={(event) => setTargetOwner(event.target.value)}
            >
              {(namespaces ?? []).map((namespace) => (
                <option key={namespace} value={namespace}>
                  {namespace}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            id="fork-name"
            label="Repository name"
            required
            error={errors.name}
          >
            <input
              id="fork-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <fieldset className="fork-form__visibility">
            <legend>Visibility</legend>
            <label>
              <input
                type="radio"
                name="fork-visibility"
                value="public"
                checked={visibility === "public"}
                disabled={privateSource}
                onChange={() => setVisibility("public")}
              />
              Public
            </label>
            <label>
              <input
                type="radio"
                name="fork-visibility"
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
          {errors.targetOwner ? (
            <p role="alert" className="ui-field__error">
              {errors.targetOwner}
            </p>
          ) : null}
          {privateSource ? (
            <p className="fork-form__hint">A private repository can only be forked as Private.</p>
          ) : null}
          <div className="fork-form__actions">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !username}>
              Create fork
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
