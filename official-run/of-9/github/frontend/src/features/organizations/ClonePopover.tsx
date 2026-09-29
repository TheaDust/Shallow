import { useEffect, useRef, useState } from "react";

import { Button, Dialog, Tabs } from "../../ui";

const HTTPS_URL = "https://github.com";
const SSH_URL = "git@github.com";

type Protocol = "https" | "ssh";

function cloneValue(protocol: Protocol, owner: string, name: string): string {
  return protocol === "https"
    ? `${HTTPS_URL}/${owner}/${name}.git`
    : `${SSH_URL}:${owner}/${name}.git`;
}

async function writeToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fall through to the textarea fallback
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export function ClonePopover({ owner, name }: { owner: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [protocol, setProtocol] = useState<Protocol>("https");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copiedTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  const copy = async () => {
    setError(null);
    const ok = await writeToClipboard(cloneValue(protocol, owner, name));
    if (!ok) {
      setError("Unable to copy");
      return;
    }
    setCopied(true);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
  };

  const value = cloneValue(protocol, owner, name);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Code
      </Button>
      <Dialog open={open} title="Code" onOpenChange={setOpen}>
        <Tabs
          label="Clone protocol"
          activeId={protocol}
          onChange={(id) => {
            setProtocol(id as Protocol);
            setCopied(false);
          }}
          items={[
            {
              id: "https",
              label: "HTTPS",
              panel: (
                <CloneValuePanel
                  value={value}
                  protocol="https"
                  copied={copied && protocol === "https"}
                  error={error}
                  onCopy={() => void copy()}
                />
              ),
            },
            {
              id: "ssh",
              label: "SSH",
              panel: (
                <CloneValuePanel
                  value={value}
                  protocol="ssh"
                  copied={copied && protocol === "ssh"}
                  error={error}
                  onCopy={() => void copy()}
                />
              ),
            },
          ]}
        />
      </Dialog>
    </>
  );
}

function CloneValuePanel({
  value,
  protocol,
  copied,
  error,
  onCopy,
}: {
  value: string;
  protocol: Protocol;
  copied: boolean;
  error: string | null;
  onCopy(): void;
}) {
  return (
    <div className="clone-popover__value">
      <input
        readOnly
        className="clone-popover__field"
        aria-label={`Clone value (${protocol})`}
        value={value}
        onFocus={(event) => event.currentTarget.select()}
      />
      <Button variant="secondary" aria-label="Copy clone value" onClick={onCopy}>
        <span aria-hidden="true">⧉</span>
      </Button>
      {copied ? (
        <span role="status" className="clone-popover__copied">
          Copied
        </span>
      ) : null}
      {error ? (
        <span role="alert" className="clone-popover__error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
