import { CellNoteDialog } from "./CellNoteDialog";
import { ConditionalFormattingDialog } from "./ConditionalFormattingDialog";
import { CreatePivotDialog } from "./CreatePivotDialog";
import { DataValidationDialog } from "./DataValidationDialog";
import { DeleteWorksheetDialog } from "./DeleteWorksheetDialog";
import { FilterDialog } from "./FilterDialog";
import { FilterViewsDialog } from "./FilterViewsDialog";
import { FindReplaceDialog } from "./FindReplaceDialog";
import { NamedRangesDialog } from "./NamedRangesDialog";
import { RenameWorkbookDialog } from "./RenameWorkbookDialog";
import { RenameWorksheetDialog } from "./RenameWorksheetDialog";
import { SaveFilterViewDialog } from "./SaveFilterViewDialog";
import { SortRangeDialog } from "./SortRangeDialog";
import type { ConditionalRule, FilterColumn, SavedFilterView, ValidationRule } from "../domain/types";
import type { SortColumn } from "../domain/sort";

/** One dialog of the editor: its visibility, the data it shows and its actions. */
export interface WorkbookEditorDialogsProps {
  rename: {
    open: boolean;
    currentName: string;
    onOpenChange(open: boolean): void;
    onSave(name: string): Promise<void>;
  };
  findReplace: {
    open: boolean;
    onOpenChange(open: boolean): void;
    onFindNext(findText: string, matchCase: boolean): Promise<string>;
    onReplaceAll(findText: string, replaceText: string, matchCase: boolean): Promise<string>;
  };
  pivot: {
    open: boolean;
    range: string;
    onOpenChange(open: boolean): void;
    onCreate(): Promise<void>;
  };
  validation: {
    open: boolean;
    range: string;
    rule: ValidationRule | null;
    onOpenChange(open: boolean): void;
    onSave(rule: ValidationRule): Promise<void>;
    onDelete(): Promise<void>;
  };
  namedRanges: {
    open: boolean;
    ranges: Array<{ name: string; range: string }>;
    onOpenChange(open: boolean): void;
    onSave(name: string, range: string): Promise<void>;
  };
  conditional: {
    open: boolean;
    range: string;
    rules: ConditionalRule[];
    onOpenChange(open: boolean): void;
    onSave(rule: ConditionalRule, index: number | null): Promise<void>;
    onDelete(index: number): Promise<void>;
  };
  note: {
    open: boolean;
    coordinate: string;
    note: string | null;
    onOpenChange(open: boolean): void;
    onSave(text: string): Promise<void>;
    onDelete(): Promise<void>;
  };
  filter: {
    open: boolean;
    column: number;
    header: string;
    values: string[];
    rule: FilterColumn | null;
    onOpenChange(open: boolean): void;
    onApply(rule: FilterColumn): Promise<void>;
  };
  saveFilterView: {
    open: boolean;
    onOpenChange(open: boolean): void;
    onSave(name: string): Promise<void>;
  };
  filterViews: {
    open: boolean;
    views: SavedFilterView[];
    selectedName: string | null;
    onOpenChange(open: boolean): void;
    onSelect(name: string): Promise<void>;
    onDelete(name: string): Promise<void>;
  };
  sort: {
    open: boolean;
    columns: SortColumn[];
    onOpenChange(open: boolean): void;
    onSort(request: { column: number; order: "asc" | "desc"; hasHeaderRow: boolean }): Promise<void>;
  };
  renameWorksheet: {
    open: boolean;
    currentName: string;
    onOpenChange(open: boolean): void;
    onSave(name: string): Promise<void>;
  };
  deleteWorksheet: {
    open: boolean;
    worksheetName: string;
    onOpenChange(open: boolean): void;
    onDelete(): Promise<void>;
  };
}

/**
 * Every dialog of the workbook editor in one place: the workbook and worksheet
 * dialogs, the data tools (filter, filter views, pivot, sort, validation, named
 * ranges, conditional formatting) and the cell note dialog. Each dialog owns its
 * own fields; the page passes the state it shows and the actions it performs.
 */
export function WorkbookEditorDialogs({
  rename,
  findReplace,
  pivot,
  validation,
  namedRanges,
  conditional,
  note,
  filter,
  saveFilterView,
  filterViews,
  sort,
  renameWorksheet,
  deleteWorksheet,
}: WorkbookEditorDialogsProps) {
  return (
    <>
      <RenameWorkbookDialog
        open={rename.open}
        currentName={rename.currentName}
        onOpenChange={rename.onOpenChange}
        onSave={rename.onSave}
      />
      <FindReplaceDialog
        open={findReplace.open}
        onOpenChange={findReplace.onOpenChange}
        onFindNext={findReplace.onFindNext}
        onReplaceAll={findReplace.onReplaceAll}
      />
      <CreatePivotDialog
        open={pivot.open}
        range={pivot.range}
        onOpenChange={pivot.onOpenChange}
        onCreate={pivot.onCreate}
      />
      <DataValidationDialog
        open={validation.open}
        range={validation.range}
        rule={validation.rule}
        onOpenChange={validation.onOpenChange}
        onSave={validation.onSave}
        onDelete={validation.onDelete}
      />
      <NamedRangesDialog
        open={namedRanges.open}
        ranges={namedRanges.ranges}
        onOpenChange={namedRanges.onOpenChange}
        onSave={namedRanges.onSave}
      />
      <ConditionalFormattingDialog
        open={conditional.open}
        range={conditional.range}
        rules={conditional.rules}
        onOpenChange={conditional.onOpenChange}
        onSave={conditional.onSave}
        onDelete={conditional.onDelete}
      />
      <CellNoteDialog
        open={note.open}
        coordinate={note.coordinate}
        note={note.note}
        onOpenChange={note.onOpenChange}
        onSave={note.onSave}
        onDelete={note.onDelete}
      />
      <FilterDialog
        open={filter.open}
        column={filter.column}
        header={filter.header}
        values={filter.values}
        rule={filter.rule}
        onOpenChange={filter.onOpenChange}
        onApply={filter.onApply}
      />
      <SaveFilterViewDialog
        open={saveFilterView.open}
        onOpenChange={saveFilterView.onOpenChange}
        onSave={saveFilterView.onSave}
      />
      <FilterViewsDialog
        open={filterViews.open}
        views={filterViews.views}
        selectedName={filterViews.selectedName}
        onOpenChange={filterViews.onOpenChange}
        onSelect={filterViews.onSelect}
        onDelete={filterViews.onDelete}
      />
      <SortRangeDialog
        open={sort.open}
        columns={sort.columns}
        onOpenChange={sort.onOpenChange}
        onSort={sort.onSort}
      />
      <RenameWorksheetDialog
        open={renameWorksheet.open}
        currentName={renameWorksheet.currentName}
        onOpenChange={renameWorksheet.onOpenChange}
        onSave={renameWorksheet.onSave}
      />
      <DeleteWorksheetDialog
        open={deleteWorksheet.open}
        worksheetName={deleteWorksheet.worksheetName}
        onOpenChange={deleteWorksheet.onOpenChange}
        onDelete={deleteWorksheet.onDelete}
      />
    </>
  );
}
