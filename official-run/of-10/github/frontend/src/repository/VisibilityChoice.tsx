import type { RepositoryVisibility } from "../lib/repositories-api";

export interface VisibilityChoiceProps {
  /** Radio group name; the two options are always `Public` and `Private`. */
  groupName: string;
  legend: string;
  value: RepositoryVisibility;
  onChange(value: RepositoryVisibility): void;
  /** A private source repository can only be forked as private. */
  publicDisabled?: boolean;
}

/** The shared Public/Private radio pair of the repository forms. */
export function VisibilityChoice({
  groupName,
  legend,
  value,
  onChange,
  publicDisabled,
}: VisibilityChoiceProps) {
  return (
    <fieldset className="visibility-choice">
      <legend>{legend}</legend>
      <label className="visibility-choice__option">
        <input
          type="radio"
          name={groupName}
          value="public"
          checked={value === "public"}
          disabled={publicDisabled}
          onChange={() => onChange("public")}
        />
        Public
      </label>
      <label className="visibility-choice__option">
        <input
          type="radio"
          name={groupName}
          value="private"
          checked={value === "private"}
          onChange={() => onChange("private")}
        />
        Private
      </label>
    </fieldset>
  );
}
