import { useEffect, useRef, useState } from "react";

import { writeClipboardText } from "../lib/clipboard";
import type { RepositorySummary } from "../lib/org-api";
import { Button } from "../ui/Button";
import { Tabs } from "../ui/Tabs";

type CloneProtocol = "https" | "ssh";

/**
 * The "Code" button of a repository overview. It opens a clone popover with an
 * "HTTPS" tab and an "SSH" tab; each tab shows the read-only clone address and a
 * button that copies the selected value to the clipboard. The operation never
 * changes repository data, so it stays available to any visitor who may read the
 * repository.
 */
export function CloneMenu({ repository }: { repository: RepositorySummary }) {
  const [open, setOpen] = useState(false);
  const [protocol, setProtocol] = useState<CloneProtocol>("https");
  const [copied, setCopied] = useState<CloneProtocol | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);

  const values: Record<CloneProtocol, string> = {
    https: `https://shallowcode.local/${repository.owner.id}/${repository.name}.git`,
    ssh: `git@shallowcode.local:${repository.owner.id}/${repository.name}.git`,
  };

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
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

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const copy = async () => {
    const value = values[protocol];
    try {
      await writeClipboardText(value);
      setError(null);
      setCopied(protocol);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(null), 4000);
    } catch {
      setCopied(null);
      setError("Unable to copy the clone address");
    }
  };

  const panel = (value: string) => (
    <div className="clone-menu__row">
      <code className="clone-menu__value">{value}</code>
      <Button variant="secondary" onClick={copy}>
        Copy
      </Button>
    </div>
  );

  return (
    <div className="clone-menu" ref={rootRef}>
      <Button
        variant="secondary"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
          setCopied(null);
          setError(null);
        }}
      >
        Code
      </Button>
      {open ? (
        <div className="clone-menu__popover">
          <Tabs
            label="Clone protocol"
            activeId={protocol}
            onChange={(id) => {
              setProtocol(id as CloneProtocol);
              setCopied(null);
            }}
            items={[
              { id: "https", label: "HTTPS", panel: panel(values.https) },
              { id: "ssh", label: "SSH", panel: panel(values.ssh) },
            ]}
          />
          {copied ? (
            <p className="clone-menu__feedback" role="status">
              Copied
            </p>
          ) : null}
          {error ? (
            <p className="clone-menu__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
