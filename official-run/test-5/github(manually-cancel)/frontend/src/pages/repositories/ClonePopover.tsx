import { useEffect, useState } from "react";

import { writeToClipboard } from "../../lib/clipboard";
import { cloneValue } from "../../repo/repo-api";
import type { CloneProtocol } from "../../repo/types";
import { Button } from "../../ui/Button";
import { Popover } from "../../ui/Popover";
import { Tabs } from "../../ui/Tabs";

export interface ClonePopoverProps {
  ownerName: string;
  repositoryName: string;
}

/**
 * REQ-3-2-3: the clone popover of the repository overview. The trigger is a
 * “Code” button (distinct from the “Code” navigation link); the panel offers the
 * “HTTPS” and “SSH” protocol tabs and a “Copy clone value” button that writes the
 * selected read-only value to the clipboard and reports “Copied”. The selected
 * protocol stays selected when the popover is closed and opened again.
 */
export function ClonePopover({ ownerName, repositoryName }: ClonePopoverProps) {
  const [protocol, setProtocol] = useState<CloneProtocol>("https");
  const [copied, setCopied] = useState<CloneProtocol | null>(null);
  const [failed, setFailed] = useState<CloneProtocol | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 5000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async (selected: CloneProtocol, value: string) => {
    try {
      await writeToClipboard(value);
      setCopied(selected);
      setFailed(null);
    } catch {
      setCopied(null);
      setFailed(selected);
    }
  };

  const valueRow = (id: CloneProtocol) => {
    const value = cloneValue(id, ownerName, repositoryName);
    return (
      <div className="clone-value">
        <input
          className="clone-value__input"
          type="text"
          readOnly
          aria-label="Clone value"
          value={value}
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button onClick={() => copy(id, value)} aria-label="Copy clone value">
          <span aria-hidden="true" className="clone-value__icon">
            ⧉
          </span>
          Copy clone value
        </Button>
        {copied === id ? (
          <span role="status" className="clone-value__feedback">
            Copied
          </span>
        ) : null}
        {failed === id ? (
          <span role="alert" className="clone-value__feedback">
            Unable to copy to the clipboard
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <Popover triggerLabel="Code" label="Clone this repository" triggerVariant="primary">
      {() => (
        <Tabs
          label="Clone protocol"
          activeId={protocol}
          onChange={(id) => setProtocol(id === "ssh" ? "ssh" : "https")}
          items={[
            { id: "https", label: "HTTPS", panel: valueRow("https") },
            { id: "ssh", label: "SSH", panel: valueRow("ssh") },
          ]}
        />
      )}
    </Popover>
  );
}
