import { useEffect, useId, useState } from "react";

import { writeClipboardText } from "../../lib/clipboard";
import { Button } from "../../ui/Button";
import { Tabs } from "../../ui/Tabs";
import type { RepositoryCloneUrls } from "./repository-api";

export interface CloneMenuProps {
  repositoryName: string;
  cloneUrls: RepositoryCloneUrls;
}

const PROTOCOLS = ["HTTPS", "SSH"] as const;
type Protocol = (typeof PROTOCOLS)[number];

const PROTOCOL_LABELS: Record<Protocol, string> = { HTTPS: "HTTPS", SSH: "SSH" };

/**
 * The clone menu of the repository overview (REQ-3-2-3). Its trigger is a
 * button named "Code", which is distinct from the repository navigation link of
 * the same name: the popover shows the read-only clone value of the selected
 * protocol and copies it to the clipboard.
 */
export function CloneMenu({ repositoryName, cloneUrls }: CloneMenuProps) {
  const [open, setOpen] = useState(false);
  const [protocol, setProtocol] = useState<Protocol>("HTTPS");
  const [feedback, setFeedback] = useState("");
  const menuId = useId();
  const value = protocol === "HTTPS" ? cloneUrls.https : cloneUrls.ssh;

  useEffect(() => {
    if (!open) setFeedback("");
  }, [open]);

  /**
   * Writes the selected clone value to the clipboard (REQ-3-2-3). A successful
   * write reports "Copied"; only a browser that refuses every copy path shows
   * the unavailable state instead of pretending the value was copied.
   */
  const copy = async () => {
    const copied = await writeClipboardText(value);
    setFeedback(copied ? "Copied" : "Copy is not available in this browser");
  };

  /** Selecting a protocol clears the feedback of the previously copied value. */
  const selectProtocol = (next: Protocol) => {
    setProtocol(next);
    setFeedback("");
  };

  return (
    <div className="clone-menu">
      <Button
        variant="secondary"
        aria-label="Code"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        Code
      </Button>
      {open ? (
        <div id={menuId} role="dialog" aria-label={`Clone ${repositoryName}`} className="clone-menu__popover">
          <Tabs
            label="Clone protocol"
            activeId={protocol}
            onChange={(id) => selectProtocol(id as Protocol)}
            items={PROTOCOLS.map((entry) => ({
              id: entry,
              label: PROTOCOL_LABELS[entry],
              panel: (
                <div className="clone-menu__value">
                  <p className="clone-menu__value-text">{value}</p>
                  <Button
                    variant="secondary"
                    aria-label="Copy clone value"
                    onClick={() => {
                      void copy();
                    }}
                  >
                    Copy clone value
                  </Button>
                  <span role="status" className="clone-menu__feedback">
                    {feedback}
                  </span>
                </div>
              ),
            }))}
          />
        </div>
      ) : null}
    </div>
  );
}
