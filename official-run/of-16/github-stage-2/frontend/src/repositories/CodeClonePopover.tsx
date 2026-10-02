import { useEffect, useState } from "react";

import { Button, Dialog, Tabs } from "../ui";
import { cloneValue } from "./api";
import { copyTextToClipboard } from "./clipboard";

export interface CodeClonePopoverProps {
  owner: string;
  name: string;
}

type CloneProtocol = "https" | "ssh";

const CLONE_PROTOCOLS: readonly CloneProtocol[] = ["https", "ssh"];

function protocolLabel(protocol: CloneProtocol): string {
  return protocol === "ssh" ? "SSH" : "HTTPS";
}

/**
 * The repository "Code" button and its clone popover. The button is distinct
 * from the "Code" navigation link: it opens a popover with the "HTTPS" and
 * "SSH" tabs, each of them offering the read-only clone value and a button that
 * copies it. Copying shows the brief "Copied" feedback and changes no
 * repository data.
 */
export function CodeClonePopover({ owner, name }: CodeClonePopoverProps) {
  const [open, setOpen] = useState(false);
  const [protocol, setProtocol] = useState<CloneProtocol>("https");
  const [feedback, setFeedback] = useState<{ protocol: CloneProtocol; copied: boolean } | null>(null);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  // The feedback is brief: it disappears shortly after the copy succeeded.
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 2500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  async function copy(selected: CloneProtocol) {
    const copied = await copyTextToClipboard(cloneValue(selected, owner, name, origin));
    setFeedback({ protocol: selected, copied });
  }

  const items = CLONE_PROTOCOLS.map((candidate) => {
    const value = cloneValue(candidate, owner, name, origin);
    const label = protocolLabel(candidate);
    return {
      id: candidate,
      label,
      panel: (
        <div className="clone-popover__panel">
          <label className="clone-popover__label" htmlFor={`clone-value-${candidate}`}>
            {label} clone value
          </label>
          <input
            id={`clone-value-${candidate}`}
            className="clone-popover__value"
            type="text"
            readOnly
            value={value}
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button onClick={() => void copy(candidate)}>Copy</Button>
        </div>
      ),
    };
  });

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Code
      </Button>
      <Dialog
        open={open}
        title="Clone this repository"
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setFeedback(null);
        }}
        actions={
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Done
          </Button>
        }
      >
        <Tabs
          label="Clone protocol"
          items={items}
          activeId={protocol}
          onChange={(id) => {
            setProtocol(id as CloneProtocol);
            setFeedback(null);
          }}
        />
        {feedback ? (
          feedback.copied ? (
            <p className="clone-popover__feedback" role="status">
              Copied
            </p>
          ) : (
            <p className="app-form__error" role="alert">
              Copy failed. Select the value and copy it manually.
            </p>
          )
        ) : null}
      </Dialog>
    </>
  );
}
