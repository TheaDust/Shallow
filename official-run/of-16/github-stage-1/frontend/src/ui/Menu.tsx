import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Button, type ButtonProps } from "./Button";

export interface MenuItem {
  id: string;
  label: string;
  /**
   * When set the entry is a link (role `link`) instead of a button: a real href
   * navigates, while an action link (such as a confirmation trigger) keeps the
   * current page and only runs `onSelect`.
   */
  href?: string;
  disabled?: boolean;
  tone?: "default" | "danger";
  onSelect?(): void;
}

export interface MenuProps {
  triggerLabel: string;
  /** Visible trigger content; the accessible name stays `triggerLabel`. */
  triggerContent?: ReactNode;
  /**
   * When set the trigger is a link (role `link`) carrying this href while it
   * still opens the menu, so navigation entries of the surrounding page can
   * point at a real address. Without it the trigger is a button.
   */
  triggerHref?: string;
  items: readonly MenuItem[];
  menuLabel?: string;
  buttonVariant?: ButtonProps["variant"];
}

export function Menu({
  triggerLabel,
  triggerContent,
  triggerHref,
  menuLabel = triggerLabel,
  items,
  buttonVariant = "secondary",
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const openingFocus = useRef(0);
  const menuId = useId();

  const focusItem = (index: number) => {
    const enabled = items.map((item, itemIndex) => ({ item, itemIndex })).filter(({ item }) => !item.disabled);
    if (!enabled.length) return;
    const normalized = (index + enabled.length) % enabled.length;
    itemRefs.current[enabled[normalized].itemIndex]?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    const enabled = itemRefs.current.filter((item, index) => item && !items[index].disabled);
    (openingFocus.current === -1 ? enabled.at(-1) : enabled[0])?.focus();
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const toggleOpen = () => {
    openingFocus.current = 0;
    setOpen((value) => !value);
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openingFocus.current = event.key === "ArrowDown" ? 0 : -1;
      if (open) focusItem(openingFocus.current);
      else setOpen(true);
    }
  };

  const triggerShared = {
    "aria-label": triggerLabel,
    "aria-haspopup": "menu" as const,
    "aria-expanded": open,
    "aria-controls": open ? menuId : undefined,
    onKeyDown: handleTriggerKeyDown,
  };

  return (
    <div className="ui-menu" ref={rootRef}>
      {triggerHref !== undefined ? (
        <a
          {...triggerShared}
          ref={(node) => { triggerRef.current = node; }}
          className={`ui-button ui-button--${buttonVariant} ui-menu__trigger`}
          data-variant={buttonVariant}
          href={triggerHref}
          onClick={(event) => {
            // The trigger opens the menu; the href is the address an opened or
            // shared entry leads to, so plain activation stays on this page.
            event.preventDefault();
            toggleOpen();
          }}
        >
          {triggerContent ?? triggerLabel}
        </a>
      ) : (
        <Button
          {...triggerShared}
          ref={(node) => { triggerRef.current = node; }}
          variant={buttonVariant}
          onClick={toggleOpen}
        >
          {triggerContent ?? triggerLabel}
        </Button>
      )}
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={menuLabel}
          className="ui-menu__content"
          onKeyDown={(event) => {
            const enabledIndexes = items.map((item, index) => item.disabled ? -1 : index).filter((index) => index >= 0);
            const current = enabledIndexes.indexOf(itemRefs.current.findIndex((node) => node === document.activeElement));
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              focusItem(current + (event.key === "ArrowDown" ? 1 : -1));
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              focusItem(event.key === "Home" ? 0 : -1);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              triggerRef.current?.focus();
            }
          }}
        >
          {items.map((item, index) => {
            const closeAndFocus = () => {
              setOpen(false);
              triggerRef.current?.focus();
            };
            const sharedProps = {
              className: "ui-menu__item",
              "data-tone": item.tone ?? "default",
              "aria-disabled": item.disabled || undefined,
              tabIndex: -1,
            };
            if (item.href !== undefined) {
              return (
                <a
                  key={item.id}
                  ref={(node) => { itemRefs.current[index] = node; }}
                  {...sharedProps}
                  href={item.href}
                  onClick={(event) => {
                    if (item.disabled) {
                      event.preventDefault();
                      return;
                    }
                    if (item.onSelect) {
                      // Action links stay on the current page and only run their effect.
                      event.preventDefault();
                      item.onSelect();
                    }
                    closeAndFocus();
                  }}
                >
                  {item.label}
                </a>
              );
            }
            return (
              <button
                key={item.id}
                ref={(node) => { itemRefs.current[index] = node; }}
                {...sharedProps}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  item.onSelect?.();
                  closeAndFocus();
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
