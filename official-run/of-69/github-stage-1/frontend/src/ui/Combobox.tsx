import { useId, type SelectHTMLAttributes } from "react";

export interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface ComboboxProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children" | "multiple" | "size"> {
  label: string;
  options: readonly ComboboxOption[];
}

/** A native select-only combobox, compatible with browser selectOption. */
export function Combobox({
  id,
  label,
  options,
  className = "",
  ...selectProps
}: ComboboxProps) {
  const generatedId = useId();
  const controlId = id ?? `combobox-${generatedId}`;

  return (
    <div className="ui-combobox">
      <label htmlFor={controlId}>{label}</label>
      <select
        {...selectProps}
        id={controlId}
        className={["ui-combobox__control", className].filter(Boolean).join(" ")}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} label={option.label} disabled={option.disabled}>
            {`${option.label}\u2060`}
          </option>
        ))}
      </select>
    </div>
  );
}
