import { useEffect, useState } from "react";

import { writeClipboard } from "../../lib/clipboard";
import { cloneValues } from "../../lib/repositories-api";
import { Button } from "../../ui/Button";
import { Tabs } from "../../ui/Tabs";

export type CloneProtocol = "https" | "ssh";

export interface ClonePopoverProps {
  owner: string;
  name: string;
}

const COPIED_FEEDBACK_MS = 4000;

/**
 * Read-only clone popover of a repository page. The trigger is a button named
 * `Code`, separate from the `Code` navigation link of the same repository; the
 * protocol tabs choose which complete clone address the copy button writes to
 * the clipboard. Nothing here changes the repository.
 */
export function ClonePopover({ owner, name }: ClonePopoverProps) {
  const [open, setOpen] = useState(false);
  const [protocol, setProtocol] = useState<CloneProtocol>("https");
  // The selected protocol survives closing and reopening the popover.
  const [copied, setCopied] = useState(false);
  const values = cloneValues(owner, name);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const valueRow = (value: string) => (
    <div className="clone-popover__row">
      <code className="clone-popover__value">{value}</code>
      <Button
        aria-label="Copy clone value"
        onClick={() => {
          void writeClipboard(value).then(() => setCopied(true));
        }}
      >
        <span aria-hidden="true">⧉</span>
      </Button>
      {copied ? (
        <span role="status" className="clone-popover__copied">
          Copied
        </span>
      ) : null}
    </div>
  );

  return (
    <div className="clone-popover">
      <Button aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        Code
      </Button>
      {open ? (
        <div className="clone-popover__panel" role="group" aria-label="Clone">
          <Tabs
            label="Clone protocol"
            activeId={protocol}
            onChange={(id) => {
              setProtocol(id === "ssh" ? "ssh" : "https");
              setCopied(false);
            }}
            items={[
              { id: "https", label: "HTTPS", panel: valueRow(values.https) },
              { id: "ssh", label: "SSH", panel: valueRow(values.ssh) },
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}
