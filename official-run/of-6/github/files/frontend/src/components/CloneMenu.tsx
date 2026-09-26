import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

export type CloneProtocol = 'https' | 'ssh';

/**
 * REQ-3-2-3: the clone addresses shown in the repository "Code" popover.
 * These are read-only addresses (this product does not implement an external
 * Git protocol): the HTTPS value uses the HTTPS protocol, the SSH value uses
 * the SSH format with the colon separator and the .git suffix, and both
 * identify the current repository by owner/name.
 */
export function cloneUrls(owner: string, name: string): Record<CloneProtocol, string> {
  return {
    https: `https://github.com/${owner}/${name}.git`,
    ssh: `git@github.com:${owner}/${name}.git`,
  };
}

interface CloneMenuProps {
  owner: string;
  name: string;
}

/**
 * REQ-3-2-3 "Copy a Repository Clone Value": the clone popover opened by the
 * "Code" button (distinct from the repository navigation link "Code"). The
 * popover offers the HTTPS and SSH protocol tabs; the selected clone value is
 * displayed read-only next to the copy control (accessible name "Copy clone
 * value") that writes the complete value to the browser clipboard and shows
 * brief "Copied" feedback. The selected protocol survives closing and
 * reopening the menu and the operation never modifies the repository. The
 * popover is only reachable on a page the server already authorized, so
 * unauthorized users cannot obtain any clone value.
 */
export default function CloneMenu({ owner, name }: CloneMenuProps) {
  const [open, setOpen] = useState(false);
  const [protocol, setProtocol] = useState<CloneProtocol>('https');
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const httpsTabRef = useRef<HTMLButtonElement>(null);
  const sshTabRef = useRef<HTMLButtonElement>(null);
  const resetTimerRef = useRef<number | null>(null);

  const values = cloneUrls(owner, name);
  const value = values[protocol];

  // Close the popover when the user clicks outside of it.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onMouseDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  // Clear a pending feedback-reset timer on unmount.
  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const selectProtocol = useCallback((next: CloneProtocol) => {
    setProtocol(next);
    setCopied(false);
    setCopyFailed(false);
  }, []);

  const handleTabKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        selectProtocol('ssh');
        sshTabRef.current?.focus();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        selectProtocol('https');
        httpsTabRef.current?.focus();
      }
    },
    [selectProtocol]
  );

  const handleCopy = useCallback(async () => {
    setCopyFailed(false);
    try {
      if (
        !navigator.clipboard ||
        typeof navigator.clipboard.writeText !== 'function'
      ) {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      // Brief feedback: revert the copied state shortly after it appeared.
      resetTimerRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  }, [value]);

  return (
    <div ref={containerRef} className="clone-menu">
      <button
        type="button"
        className="clone-menu-trigger"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Code <span aria-hidden="true" className="clone-menu-caret">▾</span>
      </button>
      {open ? (
        <div className="clone-popover">
          <div
            role="tablist"
            aria-label="Clone protocol"
            className="clone-tablist"
            onKeyDown={handleTabKeyDown}
          >
            <button
              ref={httpsTabRef}
              type="button"
              role="tab"
              id="clone-tab-https"
              aria-selected={protocol === 'https'}
              className={`clone-tab${protocol === 'https' ? ' active' : ''}`}
              onClick={() => selectProtocol('https')}
            >
              HTTPS
            </button>
            <button
              ref={sshTabRef}
              type="button"
              role="tab"
              id="clone-tab-ssh"
              aria-selected={protocol === 'ssh'}
              className={`clone-tab${protocol === 'ssh' ? ' active' : ''}`}
              onClick={() => selectProtocol('ssh')}
            >
              SSH
            </button>
          </div>
          <div
            role="tabpanel"
            aria-labelledby={
              protocol === 'https' ? 'clone-tab-https' : 'clone-tab-ssh'
            }
            className="clone-tabpanel"
          >
            <div className="clone-value-row">
              <code className="clone-value">{value}</code>
              <button
                type="button"
                className="clone-copy-button"
                aria-label="Copy clone value"
                onClick={handleCopy}
              >
                <span aria-hidden="true">{copied ? '✓' : '⧉'}</span>
              </button>
            </div>
            {copied ? (
              <p className="clone-copied" role="status">
                Copied
              </p>
            ) : null}
            {copyFailed ? (
              <p className="clone-copy-failed" role="alert">
                Copy failed
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
