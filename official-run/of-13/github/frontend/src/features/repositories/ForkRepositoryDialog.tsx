import { useEffect, useState, type FormEvent } from "react";

import { navigate } from "../../lib/hash-route";
import { listMyOrganizations, type OrganizationMembership, type RepositoryVisibility } from "../../lib/organizations-api";
import { repositoryPath } from "../../lib/repository-code-api";
import { fieldErrorsOf, forkRepository } from "../../lib/repositories-api";
import { useAccountSession } from "../account/AccountSession";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { FormField } from "../../ui/FormField";

export interface ForkSource {
  owner: string;
  name: string;
  visibility: RepositoryVisibility;
}

export interface ForkRepositoryDialogProps {
  source: ForkSource;
  open: boolean;
  onOpenChange(open: boolean): void;
}

/**
 * Fork form of a readable source repository: the target namespace defaults to
 * the signed-in user's personal namespace and the visibility defaults to an
 * allowed value, so submitting after editing only the name is possible. The
 * server validates both ends and creates nothing when a check fails.
 */
export function ForkRepositoryDialog({ source, open, onOpenChange }: ForkRepositoryDialogProps) {
  const { account } = useAccountSession();
  const [organizations, setOrganizations] = useState<OrganizationMembership[]>([]);
  const [owner, setOwner] = useState("");
  const [name, setName] = useState(source.name);
  const [visibility, setVisibility] = useState<RepositoryVisibility>(
    source.visibility === "private" ? "private" : "public",
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Opening the form starts from the documented defaults again.
  useEffect(() => {
    if (!open) return;
    setOwner(account?.username ?? "");
    setName(source.name);
    setVisibility(source.visibility === "private" ? "private" : "public");
    setFieldErrors({});
    setFormError(null);
  }, [open, account?.username, source.name, source.visibility]);

  useEffect(() => {
    if (!open || !account) return;
    let cancelled = false;
    listMyOrganizations()
      .then((list) => {
        if (!cancelled) setOrganizations(list.filter((entry) => entry.role === "owner"));
      })
      .catch(() => {
        if (!cancelled) setOrganizations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, account]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);
    try {
      const fork = await forkRepository(source.owner, source.name, {
        owner,
        name,
        visibility,
      });
      onOpenChange(false);
      navigate(repositoryPath(fork.owner, fork.name));
    } catch (error) {
      const errors = fieldErrorsOf(error);
      setFieldErrors(errors);
      if (Object.keys(errors).length === 0) setFormError("Repository not forked");
    } finally {
      setSubmitting(false);
    }
  }

  const ownerOptions = [
    ...(account ? [{ value: account.username, label: account.username }] : []),
    ...organizations.map((organization) => ({
      value: organization.name,
      label: organization.name,
    })),
  ];

  return (
    <Dialog
      open={open}
      title={`Fork ${source.name}`}
      onOpenChange={onOpenChange}
    >
      <form className="fork-form" onSubmit={handleSubmit} noValidate>
        <FormField id="fork-owner" label="Owner" error={fieldErrors.owner}>
          <select
            id="fork-owner"
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
          >
            {ownerOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="fork-name" label="Repository name" error={fieldErrors.name}>
          <input
            id="fork-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <fieldset className="ui-field">
          <legend>Visibility</legend>
          <label htmlFor="fork-visibility-public">
            <input
              id="fork-visibility-public"
              type="radio"
              name="fork-visibility"
              value="public"
              checked={visibility === "public"}
              onChange={() => setVisibility("public")}
            />
            Public
          </label>
          <label htmlFor="fork-visibility-private">
            <input
              id="fork-visibility-private"
              type="radio"
              name="fork-visibility"
              value="private"
              checked={visibility === "private"}
              onChange={() => setVisibility("private")}
            />
            Private
          </label>
          {fieldErrors.visibility ? (
            <p className="ui-field__error" role="alert">
              {fieldErrors.visibility}
            </p>
          ) : null}
        </fieldset>
        {formError ? (
          <p className="ui-field__error" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="fork-form__actions">
          <Button type="submit" variant="primary" disabled={submitting}>
            Create fork
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * The `Fork` button of a readable repository overview plus its form. A visitor
 * without a session is sent to the account-access page, because only a
 * signed-in user can create the fork.
 */
export function ForkRepositoryButton({
  source,
  signedIn = true,
}: {
  source: ForkSource;
  signedIn?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!signedIn) {
    return <Button onClick={() => navigate("/login")}>Fork</Button>;
  }
  return (
    <>
      <Button onClick={() => setOpen(true)}>Fork</Button>
      {open ? (
        <ForkRepositoryDialog source={source} open onOpenChange={setOpen} />
      ) : null}
    </>
  );
}
