import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export interface OptionComboboxProps {
  /** Accessible name of the combobox; also its visible label. */
  label: string;
  /** Currently chosen option. */
  value: string;
  options: readonly string[];
  onChange(value: string): void;
  id?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Combobox whose options are exposed as clickable `role="option"` entries.
 *
 * Opening the control lists every option in the page, so the choice is made by
 * clicking an option (or with the keyboard) instead of inside a platform
 * popup; the native `<select>` stays the right control for the fields that ask
 * for one (REQ-2-2-2 `Parent team`, the grant rows of REQ-2-3).
 */
export function OptionCombobox({
  label,
  value,
  options,
  onChange,
  id,
  error,
  disabled,
  className = "",
}: OptionComboboxProps) {
  const generatedId = useId();
  const triggerId = id ?? `option-combobox-${generatedId}`;
  const labelId = `${triggerId}-label`;
  const listId = `${triggerId}-listbox`;
  const errorId = `${triggerId}-error`;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  const pendingFocus = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const index = pendingFocus.current;
    pendingFocus.current = null;
    if (index === null || options.length === 0) return;
    optionRefs.current[(index + options.length) % options.length]?.focus();
  }, [open, options]);

  const openWithFocus = (index: number) => {
    if (open) {
      optionRefs.current[index]?.focus();
      return;
    }
    pendingFocus.current = index;
    setOpen(true);
  };

  const commit = (option: string) => {
    onChange(option);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const selected = options.indexOf(value);
      openWithFocus(event.key === "ArrowUp" ? Math.max(0, selected === -1 ? 0 : selected) : selected === -1 ? 0 : selected);
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  const onOptionKeyDown = (event: KeyboardEvent<HTMLLIElement>, index: number) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      optionRefs.current[(index + 1) % options.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      optionRefs.current[(index - 1 + options.length) % options.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      optionRefs.current[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      optionRefs.current[options.length - 1]?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      commit(options[index]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <div
      className={["ui-field", "ui-option-combobox", className].filter(Boolean).join(" ")}
      data-invalid={error ? true : undefined}
      ref={rootRef}
    >
      <span className="ui-field__label" id={labelId}>{label}</span>
      <button
        type="button"
        id={triggerId}
        ref={triggerRef}
        role="combobox"
        className="ui-option-combobox__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={labelId}
        aria-describedby={error ? errorId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="ui-option-combobox__value">{value}</span>
        <span className="ui-option-combobox__caret" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <ul className="ui-option-combobox__options" id={listId} role="listbox" aria-labelledby={labelId}>
          {options.map((option, index) => (
            <li
              key={option}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              role="option"
              aria-selected={option === value}
              tabIndex={-1}
              className="ui-option-combobox__option"
              onClick={() => commit(option)}
              onKeyDown={(event) => onOptionKeyDown(event, index)}
            >
              {option}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p id={errorId} className="ui-field__error" role="alert">{error}</p>
      ) : null}
    </div>
  );
}
