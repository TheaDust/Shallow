import { useId, type SelectHTMLAttributes } from "react";

export interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface ComboboxProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  label: string;
  options: readonly ComboboxOption[];
}

export function Combobox({ id, label, options, className = "", ...props }: ComboboxProps) {
  const generatedId = useId();
  const selectId = id ?? `combobox-${generatedId}`;
  return (
    <div className="ui-combobox">
      <label htmlFor={selectId}>{label}</label>
      <select {...props} id={selectId} className={["ui-combobox__control", className].filter(Boolean).join(" ")}>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}
