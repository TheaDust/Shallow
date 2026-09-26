import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createMockServer, type MockServer } from './test/mockServer';
import type { Workbook } from './types';

// The REQ-5-3-1 evaluation seed: seeded worksheet range A1:C6 with headers
// Region/Sales/Status and rows East/1200/Open, North/800/Closed,
// South/700/Open.
function pivotSeedWorkbook(id: string): Workbook {
  return {
    id,
    name: 'Q3 Sales',
    lastUpdated: '2026-09-25T10:00:00.000Z',
    activeSheetId: 'sheet1',
    sheets: [
      {
        id: 'sheet1',
        name: 'Sheet1',
        rowCount: 6,
        columnCount: 3,
        cells: {
          A1: 'Region',
          B1: 'Sales',
          C1: 'Status',
          A2: 'East',
          B2: '1200',
          C2: 'Open',
          A3: 'North',
          B3: '800',
          C3: 'Closed',
          A4: 'South',
          B4: '700',
          C4: 'Open',
        },
        filterViews: [],
        validationRules: [],
      },
    ],
    pivots: [],
  };
}

describe('REQ-5-3-1 Create and Refresh a Basic Pivot Table', () => {
  let server: MockServer;
  let workbookId: string;

  beforeEach(() => {
    // Each case seeds a unique workbook id so delayed save-queue PUTs from a
    // previous case hit 404 instead of overwriting the fresh seed (the known
    // mock-harness caveat, see ARCHITECTURE.md).
    workbookId = 'q3-sales-' + Math.random().toString(36).slice(2, 10);
    server = createMockServer([pivotSeedWorkbook(workbookId)]);
    vi.stubGlobal('fetch', server.fetch);
    window.location.hash = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function workbookOf(): Workbook {
    return server.workbooks.get(workbookId)!;
  }

  function sheetByName(name: string) {
    return workbookOf().sheets.find((s) => s.name === name)!;
  }

  async function openEditor() {
    const user = userEvent.setup();
    const view = render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Q3 Sales' }));
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    return { user, view };
  }

  function selectRange(anchor: string, active: string) {
    fireEvent.mouseDown(screen.getByRole('gridcell', { name: anchor }));
    fireEvent.mouseEnter(screen.getByRole('gridcell', { name: active }));
    fireEvent.mouseUp(window);
  }

  async function createPivot(user: ReturnType<typeof userEvent.setup>) {
    selectRange('A1', 'C6');
    await user.click(screen.getByRole('button', { name: 'Data' }));
    await user.click(screen.getByRole('menuitem', { name: 'Create pivot table' }));
    const dialog = screen.getByRole('dialog', { name: 'Create pivot table' });
    expect(within(dialog).getByText('Source range: A1:C6')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    await screen.findByRole('tab', { name: 'Pivot1' });
  }

  function editorRegion() {
    return screen.getByRole('region', { name: 'Pivot table editor' });
  }

  async function applyDefaults(user: ReturnType<typeof userEvent.setup>) {
    const region = editorRegion();
    await user.click(within(region).getByRole('button', { name: 'Apply' }));
  }

  it('the Data menu provides Create pivot table; the named dialog shows the source range, a New worksheet radio and Create', async () => {
    const { user } = await openEditor();

    await user.click(screen.getByRole('button', { name: 'Data' }));
    const menu = screen.getByRole('menu', { name: 'Data menu' });
    expect(within(menu).getByRole('menuitem', { name: 'Create pivot table' })).toBeTruthy();

    selectRange('A1', 'C6');
    await user.click(screen.getByRole('button', { name: 'Data' }));
    await user.click(screen.getByRole('menuitem', { name: 'Create pivot table' }));

    const dialog = screen.getByRole('dialog', { name: 'Create pivot table' });
    expect(within(dialog).getByText('Source range: A1:C6')).toBeTruthy();
    const radio = within(dialog).getByRole('radio', { name: 'New worksheet' });
    expect(radio).toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeTruthy();
  });

  it('creating a pivot appends Pivot1, activates it and exposes the Pivot table editor region with the required combos', async () => {
    const { user } = await openEditor();

    await createPivot(user);

    const pivotTab = screen.getByRole('tab', { name: 'Pivot1' });
    expect(pivotTab).toHaveAttribute('aria-selected', 'true');
    const region = editorRegion();
    const rows = within(region).getByRole('combobox', { name: 'Rows' });
    expect(within(rows).getByRole('option', { name: 'Region' })).toBeTruthy();
    expect(within(rows).getByRole('option', { name: 'Sales' })).toBeTruthy();
    expect(within(rows).getByRole('option', { name: 'Status' })).toBeTruthy();
    const columns = within(region).getByRole('combobox', { name: 'Columns' });
    expect(within(columns).getByRole('option', { name: 'None' })).toBeTruthy();
    expect(within(columns).getByRole('option', { name: 'Status' })).toBeTruthy();
    const values = within(region).getByRole('combobox', { name: 'Values' });
    expect(within(values).getByRole('option', { name: 'Sales' })).toBeTruthy();
    const summarize = within(region).getByRole('combobox', { name: 'Summarize by' });
    expect(within(summarize).getByRole('option', { name: 'SUM' })).toBeTruthy();
    expect(within(summarize).getByRole('option', { name: 'COUNT' })).toBeTruthy();
    expect(within(summarize).getByRole('option', { name: 'AVERAGE' })).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Apply' })).toBeTruthy();
    expect(
      within(region).getByRole('button', { name: 'Refresh pivot table' })
    ).toBeTruthy();

    // The pivot worksheet exists and the source worksheet keeps its data.
    expect(sheetByName('Pivot1')).toBeTruthy();
    expect(sheetByName('Sheet1').cells.A4).toBe('South');
  });

  it('applying SUM with Region rows and Sales values writes the summary, keeps the source unchanged and persists after refresh', async () => {
    const { user, view } = await openEditor();

    await createPivot(user);
    await applyDefaults(user);

    // A1 displays the row-field name, B1 displays "<summarization method> of <value field>"
    await waitFor(() =>
      expect(screen.getByRole('gridcell', { name: 'A1' })).toHaveTextContent('Region')
    );
    expect(screen.getByRole('gridcell', { name: 'B1' })).toHaveTextContent('SUM of Sales');
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('East');
    expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveTextContent('1200');
    expect(screen.getByRole('gridcell', { name: 'A3' })).toHaveTextContent('North');
    expect(screen.getByRole('gridcell', { name: 'B3' })).toHaveTextContent('800');
    expect(screen.getByRole('gridcell', { name: 'A4' })).toHaveTextContent('South');
    expect(screen.getByRole('gridcell', { name: 'B4' })).toHaveTextContent('700');
    expect(screen.getByRole('gridcell', { name: 'A5' })).toHaveTextContent('Grand Total');
    expect(screen.getByRole('gridcell', { name: 'B5' })).toHaveTextContent('2700');

    // the summary is persisted on the Pivot1 worksheet; the source sheet is untouched
    await waitFor(() => expect(sheetByName('Pivot1').cells.B5).toBe('2700'));
    expect(sheetByName('Sheet1').cells.B2).toBe('1200');
    expect(sheetByName('Sheet1').cells.A4).toBe('South');
    const pivot = workbookOf().pivots[0];
    expect(pivot.name).toBe('Pivot1');
    expect(pivot.sourceRange).toBe('A1:C6');
    expect(pivot.config).toEqual({
      rowField: 'Region',
      valueField: 'Sales',
      summarizeBy: 'SUM',
    });

    // refresh/reopen keeps the same pivot worksheet, layout and results
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('tab', { name: 'Pivot1' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('gridcell', { name: 'A1' })).toHaveTextContent('Region');
    expect(screen.getByRole('gridcell', { name: 'B1' })).toHaveTextContent('SUM of Sales');
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('East');
    expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveTextContent('1200');
    expect(screen.getByRole('gridcell', { name: 'A5' })).toHaveTextContent('Grand Total');
    expect(screen.getByRole('gridcell', { name: 'B5' })).toHaveTextContent('2700');
  });

  it('COUNT counts non-empty records and AVERAGE aggregates parseable numbers', async () => {
    const { user } = await openEditor();
    await createPivot(user);
    const region = editorRegion();

    await user.selectOptions(
      within(region).getByRole('combobox', { name: 'Summarize by' }),
      'COUNT'
    );
    await user.click(within(region).getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(screen.getByRole('gridcell', { name: 'B1' })).toHaveTextContent(
        'COUNT of Sales'
      )
    );
    expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveTextContent('1');
    expect(screen.getByRole('gridcell', { name: 'B3' })).toHaveTextContent('1');
    expect(screen.getByRole('gridcell', { name: 'B4' })).toHaveTextContent('1');
    expect(screen.getByRole('gridcell', { name: 'B5' })).toHaveTextContent('3');

    await user.selectOptions(
      within(region).getByRole('combobox', { name: 'Summarize by' }),
      'AVERAGE'
    );
    await user.click(within(region).getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(screen.getByRole('gridcell', { name: 'B1' })).toHaveTextContent(
        'AVERAGE of Sales'
      )
    );
    expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveTextContent('1200');
    expect(screen.getByRole('gridcell', { name: 'B5' })).toHaveTextContent('900');
  });

  it('a column field arranges values from B1 onward with a final Grand Total column; COUNT shows 0 for empty combinations', async () => {
    const { user } = await openEditor();
    await createPivot(user);
    const region = editorRegion();

    await user.selectOptions(
      within(region).getByRole('combobox', { name: 'Columns' }),
      'Status'
    );
    await user.selectOptions(
      within(region).getByRole('combobox', { name: 'Summarize by' }),
      'COUNT'
    );
    await user.click(within(region).getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(screen.getByRole('gridcell', { name: 'A1' })).toHaveTextContent('Region')
    );
    expect(screen.getByRole('gridcell', { name: 'B1' })).toHaveTextContent('Open');
    expect(screen.getByRole('gridcell', { name: 'C1' })).toHaveTextContent('Closed');
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('Grand Total');
    expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveTextContent('1'); // East/Open
    expect(screen.getByRole('gridcell', { name: 'C2' })).toHaveTextContent('0'); // East/Closed
    expect(screen.getByRole('gridcell', { name: 'B3' })).toHaveTextContent('0'); // North/Open
    expect(screen.getByRole('gridcell', { name: 'C3' })).toHaveTextContent('1'); // North/Closed
    expect(screen.getByRole('gridcell', { name: 'D5' })).toHaveTextContent('3');
    await waitFor(() => expect(sheetByName('Pivot1').cells.D1).toBe('Grand Total'));
    expect(workbookOf().pivots[0].config).toMatchObject({
      columnField: 'Status',
      summarizeBy: 'COUNT',
    });
  });

  it('a row/column change inside the source range keeps the old summary until refresh recomputes it with the adjusted range', async () => {
    const { user } = await openEditor();
    await createPivot(user);
    await applyDefaults(user);
    await waitFor(() => expect(sheetByName('Pivot1').cells.B5).toBe('2700'));

    // insert a blank column left of column B on the source sheet
    await user.click(screen.getByRole('tab', { name: 'Sheet1' }));
    fireEvent.contextMenu(screen.getByRole('columnheader', { name: 'B' }));
    await user.click(screen.getByRole('menuitem', { name: 'Insert 1 column left' }));
    await waitFor(() => expect(workbookOf().pivots[0].stale).toBe(true));
    expect(workbookOf().pivots[0].adjustedRange).toBe('A1:D6');

    // the stored result is unchanged until refresh
    await user.click(screen.getByRole('tab', { name: 'Pivot1' }));
    expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveTextContent('1200');
    expect(screen.getByRole('gridcell', { name: 'B5' })).toHaveTextContent('2700');

    await user.click(
      within(editorRegion()).getByRole('button', { name: 'Refresh pivot table' })
    );
    await waitFor(() => expect(workbookOf().pivots[0].stale).toBeUndefined());
    expect(workbookOf().pivots[0].sourceRange).toBe('A1:D6');
    expect(screen.getByRole('gridcell', { name: 'B5' })).toHaveTextContent('2700');
    expect(sheetByName('Pivot1').cells.B5).toBe('2700');
  });

  it('after source data changes the old summary stays until Refresh pivot table recomputes it', async () => {
    const { user } = await openEditor();
    await createPivot(user);
    await applyDefaults(user);
    await waitFor(() => expect(sheetByName('Pivot1').cells.B5).toBe('2700'));

    // edit the source value on Sheet1
    await user.click(screen.getByRole('tab', { name: 'Sheet1' }));
    const b2 = screen.getByRole('textbox', { name: 'B2' });
    await user.click(b2);
    await user.clear(b2);
    await user.type(b2, '1500');
    await waitFor(() => expect(sheetByName('Sheet1').cells.B2).toBe('1500'));

    // back on the result worksheet the old summary is still shown
    await user.click(screen.getByRole('tab', { name: 'Pivot1' }));
    expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveTextContent('1200');
    expect(screen.getByRole('gridcell', { name: 'B5' })).toHaveTextContent('2700');

    await user.click(
      within(editorRegion()).getByRole('button', { name: 'Refresh pivot table' })
    );
    await waitFor(() =>
      expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveTextContent('1500')
    );
    expect(screen.getByRole('gridcell', { name: 'B5' })).toHaveTextContent('3000');
    await waitFor(() => expect(sheetByName('Pivot1').cells.B5).toBe('3000'));
  });

  it('SUM/AVERAGE applied to a value field with no parseable numbers shows the required error and preserves both worksheets', async () => {
    const wb = workbookOf();
    wb.sheets[0].cells.B2 = 'abc';
    wb.sheets[0].cells.B3 = 'xyz';
    wb.sheets[0].cells.B4 = 'qrs';
    const { user } = await openEditor();

    await createPivot(user);
    const region = editorRegion();
    await user.click(within(region).getByRole('button', { name: 'Apply' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Value field requires numeric values'
    );
    // old result (none yet) preserved; the source worksheet is not modified
    expect(sheetByName('Pivot1').cells.B2).toBeUndefined();
    expect(sheetByName('Sheet1').cells.A4).toBe('South');
    expect(sheetByName('Sheet1').cells.B2).toBe('abc');

    // COUNT does not fail because of nonnumeric content
    await user.selectOptions(
      within(region).getByRole('combobox', { name: 'Summarize by' }),
      'COUNT'
    );
    await user.click(within(region).getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(screen.getByRole('gridcell', { name: 'B5' })).toHaveTextContent('3')
    );
  });

  it('when a selected source header is deleted, refresh shows the field error, preserves the last successful result and keeps the source untouched', async () => {
    const { user, view } = await openEditor();
    await createPivot(user);
    await applyDefaults(user);
    await waitFor(() => expect(sheetByName('Pivot1').cells.B5).toBe('2700'));

    // delete the Sales column (the value field header) on the source sheet
    await user.click(screen.getByRole('tab', { name: 'Sheet1' }));
    fireEvent.contextMenu(screen.getByRole('columnheader', { name: 'B' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete column' }));
    await waitFor(() => expect(workbookOf().pivots[0].stale).toBe(true));

    // open the pivot editor and refresh: the field is gone
    await user.click(screen.getByRole('tab', { name: 'Pivot1' }));
    await user.click(
      within(editorRegion()).getByRole('button', { name: 'Refresh pivot table' })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Pivot field is no longer available. Select a new field.'
    );
    // the last successful result is preserved
    expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveTextContent('1200');
    expect(screen.getByRole('gridcell', { name: 'B5' })).toHaveTextContent('2700');
    await waitFor(() => expect(workbookOf().pivots[0].fieldError).toBe(true));
    // the source worksheet keeps its adjusted (undamaged) values
    const source = sheetByName('Sheet1');
    expect(source.cells.A1).toBe('Region');
    expect(source.cells.B1).toBe('Status');
    expect(source.cells.A2).toBe('East');
    expect(source.cells.B2).toBe('Open');

    // the error persists after reopen and the result sheet keeps its summary
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Pivot field is no longer available. Select a new field.'
    );
    expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveTextContent('1200');
    expect(screen.getByRole('gridcell', { name: 'B5' })).toHaveTextContent('2700');
    expect(workbookOf().pivots[0].fieldError).toBe(true);
  });
});
