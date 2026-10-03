import { useEffect, useId, useRef, useState } from "react";

import type { RepositorySummary } from "../api/organizations";
import { copyTextToClipboard } from "../lib/clipboard";
import { Button, Tabs, type TabItem } from "../ui";

/** The two clone protocols of the popover, in the order they are shown. */
const PROTOCOLS = [
  { id: "https", label: "HTTPS" },
  { id: "ssh", label: "SSH" },
] as const;

type ProtocolId = (typeof PROTOCOLS)[number]["id"];

/**
 * The read-only clone address of one protocol. This product has no external Git
 * protocol; the value is displayed and copied only.
 */
function cloneValue(repository: RepositorySummary, protocol: ProtocolId): string {
  const path = `${repository.owner?.login ?? ""}/${repository.name}`;
  return protocol === "ssh" ? `git@github.com:${path}.git` : `https://github.com/${path}.git`;
}

/**
 * The repository “Code” button and the clone popover it opens: “HTTPS” and
 * “SSH” tabs, one copy button per tab and brief “Copied” feedback. The overview
 * heading stays in place because the popover never navigates.
 */
export function CloneMenu({ repository }: { repository: RepositorySummary }) {
  const [open, setOpen] = useState(false);
  const [protocol, setProtocol] = useState<ProtocolId>("https");
  const [copied, setCopied] = useState<ProtocolId | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const prefix = useId();
  const panelId = `${prefix}-clone`;

  useEffect(() => {
    if (!open) {
      setCopied(null);
      setFailure(null);
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // “Copied” is brief: it clears on its own and on every tab change.
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async (value: string, selected: ProtocolId) => {
    const done = await copyTextToClipboard(value);
    if (done) {
      setFailure(null);
      setCopied(selected);
    } else {
      setFailure("Copy failed");
    }
  };

  const items: TabItem[] = PROTOCOLS.map((entry) => {
    const value = cloneValue(repository, entry.id);
    return {
      id: entry.id,
      label: entry.label,
      panel: (
        <div className="clone-menu__value">
          <input
            id={`${prefix}-clone-value-${entry.id}`}
            className="clone-menu__input"
            type="text"
            readOnly
            aria-label={`${entry.label} clone value`}
            value={value}
          />
          <Button variant="secondary" onClick={() => void copy(value, entry.id)}>
            Copy
          </Button>
        </div>
      ),
    };
  });

  return (
    <div className="clone-menu" ref={rootRef}>
      <Button
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        Code
      </Button>
      {open ? (
        <div className="clone-menu__popover" id={panelId}>
          <Tabs
            label="Clone"
            items={items}
            activeId={protocol}
            onChange={(id) => {
              setProtocol(id as ProtocolId);
              setCopied(null);
              setFailure(null);
            }}
          />
          {copied ? (
            <p className="clone-menu__status" role="status">
              Copied
            </p>
          ) : null}
          {failure ? (
            <p className="form-error" role="alert">
              {failure}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
