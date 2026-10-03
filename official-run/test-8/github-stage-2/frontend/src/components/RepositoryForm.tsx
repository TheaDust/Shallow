import type { Account } from "../api/auth";
import { fetchYourOrganizations, type RepositoryVisibility } from "../api/organizations";
import { useAsyncData } from "../lib/useAsyncData";
import { FormField } from "../ui";

const VISIBILITY_LABEL: Record<RepositoryVisibility, string> = { public: "Public", private: "Private" };
const VISIBILITIES: RepositoryVisibility[] = ["public", "private"];

/**
 * The namespaces an account may create a repository in: its personal namespace
 * (listed first, so it stays the default) and every organization it owns. The
 * form can therefore be submitted without changing the owner.
 */
export function RepositoryOwnerField({
  account,
  value,
  onChange,
}: {
  account: Account;
  value: string;
  onChange(value: string): void;
}) {
  const { data } = useAsyncData(() => fetchYourOrganizations(), [account.id]);
  const organizations = (data?.organizations ?? [])
    .filter((organization) => organization.role === "owner")
    .sort((left, right) => left.displayName.localeCompare(right.displayName));

  return (
    <FormField id="repository-owner" label="Owner">
      <select
        id="repository-owner"
        name="owner"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value={account.username}>{account.username}</option>
        {organizations.map((organization) => (
          <option key={organization.id} value={organization.slug}>
            {organization.displayName}
          </option>
        ))}
      </select>
    </FormField>
  );
}

/**
 * The “Public”/“Private” visibility radio pair. `privateOnly` (used when the
 * source repository of a fork is private) keeps the incompatible choice
 * unavailable instead of silently overriding a selection.
 */
export function RepositoryVisibilityField({
  value,
  onChange,
  privateOnly = false,
}: {
  value: RepositoryVisibility;
  onChange(value: RepositoryVisibility): void;
  privateOnly?: boolean;
}) {
  return (
    <fieldset className="visibility-options">
      <legend>Visibility</legend>
      {VISIBILITIES.map((visibility) => (
        <div key={visibility} className="visibility-option">
          <input
            id={`repository-visibility-${visibility}`}
            type="radio"
            name="repository-visibility"
            value={visibility}
            checked={privateOnly ? visibility === "private" : value === visibility}
            disabled={privateOnly && visibility === "public"}
            onChange={() => onChange(visibility)}
          />
          <label htmlFor={`repository-visibility-${visibility}`}>{VISIBILITY_LABEL[visibility]}</label>
        </div>
      ))}
    </fieldset>
  );
}
