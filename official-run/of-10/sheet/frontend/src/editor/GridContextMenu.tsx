import { ContextMenu } from "./ContextMenu";

export interface GridContextMenuProps {
  /** Offset of the menu inside the grid wrapper. */
  position: { x: number; y: number };
  onCut(): void;
  onCopy(): void;
  onPaste(): void;
  onClose(): void;
}

/** Menu opened by right-clicking (or Shift+F10) inside the grid; it commands the selected range. */
export function GridContextMenu({ position, onCut, onCopy, onPaste, onClose }: GridContextMenuProps) {
  return (
    <ContextMenu
      label="Grid context menu"
      position={position}
      onClose={onClose}
      items={[
        { id: "cut", label: "Cut", run: onCut },
        { id: "copy", label: "Copy", run: onCopy },
        { id: "paste", label: "Paste", run: onPaste },
      ]}
    />
  );
}
