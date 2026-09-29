import { useEffect, useId, useRef, useState } from "react";

// The Reviewers area on the right side of the PR detail page. The Reviewers
// button opens a picker with a Search textbox; typing an eligible username
// reveals an option with that exact accessible name and selecting it saves the
// request immediately (no separate Save action) and closes the picker. Each
// requested reviewer has a Remove <username> button that removes the request
// without a confirmation step.
export function ReviewersPanel({
  reviewers,
  candidates,
  canManage,
  onRequest,
  onRemove,
}: {
  reviewers: string[];
  candidates: string[];
  canManage: boolean;
  onRequest(username: string): void;
  onRemove(username: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    searchRef.current?.focus();
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [open]);

  const queryLower = query.trim().toLowerCase();
  const visible = candidates.filter(
    (username) => !queryLower || username.toLowerCase().includes(queryLower),
  );

  const select = (username: string) => {
    setOpen(false);
    setQuery("");
    onRequest(username);
  };

  return (
    <div className="reviewers-panel" ref={rootRef}>
      <h3 className="reviewers-panel__heading">Reviewers</h3>
      {canManage ? (
        <button
          ref={triggerRef}
          type="button"
          className="reviewers-panel__trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          onClick={() => {
            setQuery("");
            setOpen((value) => !value);
          }}
        >
          Reviewers
        </button>
      ) : null}
      {open ? (
        <div className="reviewers-panel__popover">
          <input
            ref={searchRef}
            type="search"
            aria-label="Search"
            placeholder="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="reviewers-panel__search"
          />
          <div id={listboxId} role="listbox" aria-label="Reviewers" className="reviewers-panel__list">
            {visible.length === 0 ? (
              <p className="reviewers-panel__empty">No results</p>
            ) : (
              visible.map((username) => (
                <button
                  key={username}
                  type="button"
                  role="option"
                  className="reviewers-panel__option"
                  onClick={() => select(username)}
                >
                  {username}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
      {reviewers.length > 0 ? (
        <ul className="reviewers-panel__list-current">
          {reviewers.map((username) => (
            <li key={username} className="reviewers-panel__reviewer">
              <span className="reviewers-panel__username">{username}</span>
              {canManage ? (
                <button
                  type="button"
                  className="reviewers-panel__remove"
                  onClick={() => onRemove(username)}
                >
                  Remove {username}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="reviewers-panel__empty-current">No reviewers</p>
      )}
    </div>
  );
}
