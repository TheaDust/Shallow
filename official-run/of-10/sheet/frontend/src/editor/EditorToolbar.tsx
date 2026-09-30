import { Button } from "../ui";
import { DataMenu, type DataMenuProps } from "./DataMenu";

export interface EditorToolbarProps {
  /** Undoes the most recent change of this workbook (REQ-3-2-2); disabled while there is none. */
  canUndo: boolean;
  /** Redoes the change the last undo removed; disabled once a new change replaced that branch. */
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Takes the selected rectangle of the active worksheet for a later paste. */
  onCut: () => void;
  onCopy: () => void;
  /** Pastes the copied range or the system clipboard at the current selection. */
  onPaste: () => void;
  /** Exports the currently active worksheet as CSV without touching workbook state. */
  onExport: () => void;
  /** Commands of the `Data` menu (filter view and data validation). */
  data: DataMenuProps;
  /** True while a mutation runs; the buttons stay visible but do not start a second command. */
  busy?: boolean;
}

export function EditorToolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onCut,
  onCopy,
  onPaste,
  onExport,
  data,
  busy = false,
}: EditorToolbarProps) {
  return (
    <div role="toolbar" aria-label="Editor toolbar" className="editor__toolbar">
      <Button onClick={onUndo} disabled={!canUndo || busy}>
        Undo
      </Button>
      <Button onClick={onRedo} disabled={!canRedo || busy}>
        Redo
      </Button>
      <DataMenu {...data} />
      <Button onClick={onCut}>Cut</Button>
      <Button onClick={onCopy}>Copy</Button>
      <Button onClick={onPaste}>Paste</Button>
      <Button onClick={onExport}>Export CSV</Button>
    </div>
  );
}
