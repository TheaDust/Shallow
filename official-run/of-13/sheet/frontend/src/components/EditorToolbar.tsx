import type { ReactNode } from "react";

import { Button } from "../ui/Button";

export interface EditorToolbarProps {
  /** True when the session history has a step to undo. */
  canUndo: boolean;
  /** True when the last undone step can be reapplied. */
  canRedo: boolean;
  /** True while another command is in flight: the same buttons stay visible but disabled. */
  busy?: boolean;
  onUndo(): void;
  onRedo(): void;
  onCopy(): void;
  onCut(): void;
  onPaste(): void;
  /** Remaining commands of the toolbar (CSV export). */
  children?: ReactNode;
}

/**
 * Command bar of the workbook editor: undo/redo of the session history plus the range
 * commands of the current selection. Commands keep their DOM node and become `disabled`
 * while a request is in flight, so the toolbar never changes shape mid-operation.
 */
export function EditorToolbar({
  canUndo,
  canRedo,
  busy = false,
  onUndo,
  onRedo,
  onCopy,
  onCut,
  onPaste,
  children,
}: EditorToolbarProps) {
  return (
    <div role="toolbar" aria-label="Workbook toolbar" className="editor-toolbar">
      <Button variant="ghost" disabled={busy || !canUndo} onClick={onUndo}>
        Undo
      </Button>
      <Button variant="ghost" disabled={busy || !canRedo} onClick={onRedo}>
        Redo
      </Button>
      <Button variant="ghost" disabled={busy} onClick={onCopy}>
        Copy
      </Button>
      <Button variant="ghost" disabled={busy} onClick={onCut}>
        Cut
      </Button>
      <Button variant="ghost" disabled={busy} onClick={onPaste}>
        Paste
      </Button>
      {children}
    </div>
  );
}
