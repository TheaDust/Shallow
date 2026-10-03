import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type SelectHTMLAttributes,
} from "react";

export interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface ComboboxProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children" | "multiple" | "size"> {
  label: string;
  options: readonly ComboboxOption[];
}

/**
 * Select-only combobox whose options remain ordinary DOM controls while open.
 *
 * A visually hidden select preserves form submission and the familiar
 * `onChange(event.target.value)` API. The visible control follows the ARIA
 * combobox/listbox interaction pattern, so browser users and role-based tests
 * can activate a named option instead of depending on a browser-native popup.
 */
export function Combobox({
  id,
  label,
  options,
  className = "",
  value,
  defaultValue,
  disabled = false,
  onChange,
  name,
  required,
  form,
  ...selectProps
}: ComboboxProps) {
  const generatedId = useId();
  const controlId = id ?? `combobox-${generatedId}`;
  const labelId = `${controlId}-label`;
  const listboxId = `${controlId}-listbox`;
  const nativeId = `${controlId}-native`;
  const controlled = value !== undefined;
  const initialValue = String(defaultValue ?? options.find((option) => !option.disabled)?.value ?? "");
  const [uncontrolledValue, setUncontrolledValue] = useState(initialValue);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex((option) => !option.disabled)));
  const rootRef = useRef<HTMLDivElement>(null);
  const controlRef = useRef<HTMLInputElement>(null);
  const nativeRef = useRef<HTMLSelectElement>(null);
  const selectedValue = String(controlled ? value ?? "" : uncontrolledValue);
  const selectedIndex = options.findIndex((option) => option.value === selectedValue);
  const selectedLabel = selectedIndex >= 0 ? options[selectedIndex].label : "";

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  useEffect(() => {
    if (selectedIndex >= 0 && !options[selectedIndex].disabled) setActiveIndex(selectedIndex);
  }, [selectedIndex, options]);

  const enabledIndexes = () => options
    .map((option, index) => option.disabled ? -1 : index)
    .filter((index) => index >= 0);

  const moveActive = (offset: number) => {
    const enabled = enabledIndexes();
    if (!enabled.length) return;
    const current = enabled.indexOf(activeIndex);
    const next = current < 0 ? 0 : (current + offset + enabled.length) % enabled.length;
    setActiveIndex(enabled[next]);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    if (!controlled) setUncontrolledValue(option.value);
    if (nativeRef.current) {
      nativeRef.current.value = option.value;
      nativeRef.current.dispatchEvent(new Event("change", { bubbles: true }));
    }
    setActiveIndex(index);
    setOpen(false);
    controlRef.current?.focus();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(selectedIndex >= 0 ? selectedIndex : enabledIndexes()[0] ?? 0);
      } else {
        moveActive(event.key === "ArrowDown" ? 1 : -1);
      }
    } else if (event.key === "Home" || event.key === "End") {
      if (!open) return;
      event.preventDefault();
      const enabled = enabledIndexes();
      setActiveIndex(event.key === "Home" ? enabled[0] ?? 0 : enabled.at(-1) ?? 0);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(activeIndex);
      else setOpen(true);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="ui-combobox" ref={rootRef}>
      <label id={labelId} htmlFor={controlId}>{label}</label>
      <input
        id={controlId}
        ref={controlRef}
        role="combobox"
        className={["ui-combobox__control", className].filter(Boolean).join(" ")}
        value={selectedLabel}
        readOnly
        disabled={disabled}
        aria-labelledby={labelId}
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open ? `${controlId}-option-${activeIndex}` : undefined}
        aria-autocomplete="none"
        aria-required={required || undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
      />
      <select
        {...selectProps}
        id={nativeId}
        ref={nativeRef}
        hidden
        aria-hidden="true"
        tabIndex={-1}
        name={name}
        form={form}
        required={required}
        disabled={disabled}
        value={selectedValue}
        onChange={onChange}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
        ))}
      </select>
      {open ? (
        <div id={listboxId} role="listbox" aria-labelledby={labelId} className="ui-combobox__listbox">
          {options.map((option, index) => (
            <button
              key={option.value}
              id={`${controlId}-option-${index}`}
              type="button"
              role="option"
              className="ui-combobox__option"
              aria-selected={option.value === selectedValue}
              aria-disabled={option.disabled || undefined}
              disabled={option.disabled}
              data-active={index === activeIndex || undefined}
              onPointerMove={() => {
                if (!option.disabled) setActiveIndex(index);
              }}
              onClick={() => choose(index)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
