import { useEffect, useId, useRef, useState } from "react";

export interface ListboxComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface ListboxComboboxProps {
  id?: string;
  /** Accessible name of the combobox and of its option list. */
  label: string;
  value: string;
  options: readonly ListboxComboboxOption[];
  disabled?: boolean;
  onChange(value: string): void;
}

/**
 * Combobox whose options are real page content: opening it renders the options
 * as visible `role="option"` items that can be clicked or selected with the
 * keyboard. A native `<select>` paints its options inside a browser popup, so
 * they can never be interacted with (or observed) as elements of the page; the
 * "Role" fields of REQ-2-2-3 and REQ-2-3 need the rendered form.
 */
export function ListboxCombobox({
  id,
  label,
  value,
  options,
  disabled = false,
  onChange,
}: ListboxComboboxProps) {
  const generatedId = useId();
  const controlId = id ?? `listbox-combobox-${generatedId}`;
  const listId = `${controlId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  const keyboardOpen = useRef(false);
  const [open, setOpen] = useState(false);

  const selected = options.find((option) => option.value === value) ?? null;
  const enabledOptions = options
    .map((option, index) => ({ option, index }))
    .filter(({ option }) => !option.disabled);
  const ordinalOfValue = (wanted: string) => {
    const ordinal = enabledOptions.findIndex(({ option }) => option.value === wanted);
    return ordinal >= 0 ? ordinal : 0;
  };

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  useEffect(() => {
    if (!open || !keyboardOpen.current) return;
    keyboardOpen.current = false;
    const ordinal = ordinalOfValue(value);
    optionRefs.current[enabledOptions[ordinal]?.index ?? 0]?.focus();
  }, [open]);

  const focusOrdinal = (ordinal: number) => {
    if (enabledOptions.length === 0) return;
    const normalized = ((ordinal % enabledOptions.length) + enabledOptions.length) % enabledOptions.length;
    optionRefs.current[enabledOptions[normalized].index]?.focus();
  };

  const choose = (option: ListboxComboboxOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
  };

  return (
    <div className="ui-listbox-combobox" ref={rootRef}>
      <button
        type="button"
        id={controlId}
        className="ui-listbox-combobox__control"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            keyboardOpen.current = true;
            setOpen(true);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      >
        <span className="ui-listbox-combobox__value">{selected ? selected.label : ""}</span>
      </button>
      {open ? (
        <ul id={listId} role="listbox" aria-label={label} className="ui-listbox-combobox__options">
          {options.map((option, index) => (
            <li
              key={option.value}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              role="option"
              className="ui-listbox-combobox__option"
              aria-label={option.label}
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              tabIndex={-1}
              onClick={() => choose(option)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  choose(option);
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  focusOrdinal(ordinalOfValue(option.value) + 1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  focusOrdinal(ordinalOfValue(option.value) - 1);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                }
              }}
            >
              {option.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
