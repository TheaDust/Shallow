import { useEffect, useId, useRef, useState } from "react";

import { writeToClipboard } from "../lib/clipboard";
import { repositoryCloneUrls } from "../lib/repositories-api";
import { Button } from "../ui/Button";
import { Tabs } from "../ui/Tabs";

export type CloneProtocol = "https" | "ssh";

export interface ClonePopoverProps {
  owner: string;
  name: string;
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M4 2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Zm2-.5a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5V2a.5.5 0 0 0-.5-.5Z"
      />
      <path
        fill="currentColor"
        d="M2 5a2 2 0 0 1 2-2v1.5a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5h6A.5.5 0 0 0 10.5 13H12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z"
      />
    </svg>
  );
}

/**
 * The clone popover of a repository page (REQ-3-2-3). Its "Code" button is a
 * distinct control from the navigation link of the same name: the popover shows
 * the read-only HTTPS/SSH clone values and copies the selected one.
 */
export function ClonePopover({ owner, name }: ClonePopoverProps) {
  const [open, setOpen] = useState(false);
  const [protocol, setProtocol] = useState<CloneProtocol>("https");
  const [copiedProtocol, setCopiedProtocol] = useState<CloneProtocol | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const urls = repositoryCloneUrls(owner, name);
  const value = protocol === "ssh" ? urls.ssh : urls.https;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  // The feedback is brief, while the popover keeps the selected protocol.
  useEffect(() => {
    if (!copiedProtocol) return;
    const timer = window.setTimeout(() => setCopiedProtocol(null), 3000);
    return () => window.clearTimeout(timer);
  }, [copiedProtocol]);

  async function copy() {
    if (await writeToClipboard(value)) setCopiedProtocol(protocol);
  }

  const panel = (
    <div className="clone-value">
      <code className="clone-value__address">{value}</code>
      <Button
        className="clone-value__copy"
        aria-label="Copy clone value"
        onClick={() => {
          void copy();
        }}
      >
        <CopyIcon />
      </Button>
      {copiedProtocol === protocol ? (
        <span className="clone-value__status" role="status">
          Copied
        </span>
      ) : null}
    </div>
  );

  return (
    <div className="clone-popover" ref={containerRef}>
      <Button
        variant="secondary"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        Code
      </Button>
      {open ? (
        <section id={panelId} className="clone-popover__panel" aria-label="Clone">
          <Tabs
            label="Clone protocol"
            activeId={protocol}
            onChange={(id) => setProtocol(id as CloneProtocol)}
            items={[
              { id: "https", label: "HTTPS", panel },
              { id: "ssh", label: "SSH", panel },
            ]}
          />
        </section>
      ) : null}
    </div>
  );
}
