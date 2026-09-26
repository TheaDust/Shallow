import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createMockServer, type MockServer } from './test/mockServer';
import type { Workbook } from './types';

// The REQ-5-1-1 evaluation seed: seeded worksheet range A1:C6 with headers
// Region/Sales/Status and rows East/1200/Open, North/800/Closed,
// South/700/Open.
function sortSeedWorkbook(): Workbook {
  return {
    id: 'q3-sales',
    name: 'Q3 Sales',
    lastUpdated: '2026-09-25T10:00:00.000Z',
    activeSheetId: 'sheet1',
    sheets: [
      {
        id: 'sheet1',
        name: 'Sheet1',
        rowCount: 6,
        columnCount: 4,
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
          // A cell outside the selected range: sorting must not touch it.
          D2: 'outside',
        },
        filterViews: [],
        validationRules: [],
      },
    ],
    pivots: [],
  };
}

describe('REQ-5-1-1 Sort a Data Range by a Specified Column', () => {
  let server: MockServer;

  beforeEach(() => {
    server = createMockServer([sortSeedWorkbook()]);
    vi.stubGlobal('fetch', server.fetch);
    window.location.hash = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function activeSheetCells() {
    const wb = server.workbooks.get('q3-sales')!;
    const sheet = wb.sheets.find((s) => s.id === wb.activeSheetId) ?? wb.sheets[0];
    return sheet.cells;
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

  async function openSortDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Data' }));
    await user.click(screen.getByRole('menuitem', { name: 'Sort range' }));
    return screen.getByRole('dialog', { name: 'Sort range' });
  }

  it('the Data menu provides a Sort range menuitem that opens the named dialog with the required controls', async () => {
    const { user } = await openEditor();
    selectRange('A1', 'C6');

    await user.click(screen.getByRole('button', { name: 'Data' }));
    const menu = screen.getByRole('menu', { name: 'Data menu' });
    expect(within(menu).getByRole('menuitem', { name: 'Sort range' })).toBeTruthy();

    await user.click(within(menu).getByRole('menuitem', { name: 'Sort range' }));
    const dialog = screen.getByRole('dialog', { name: 'Sort range' });
    const sortBy = within(dialog).getByRole('combobox', { name: 'Sort by' });
    expect(within(sortBy).getByRole('option', { name: 'Region' })).toBeTruthy();
    expect(within(sortBy).getByRole('option', { name: 'Sales' })).toBeTruthy();
    expect(within(sortBy).getByRole('option', { name: 'Status' })).toBeTruthy();
    const order = within(dialog).getByRole('combobox', { name: 'Order' });
    expect(within(order).getByRole('option', { name: 'Ascending' })).toBeTruthy();
    expect(within(order).getByRole('option', { name: 'Descending' })).toBeTruthy();
    expect(within(dialog).getByRole('checkbox', { name: 'Data has header row' })).toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Sort' })).toBeTruthy();
  });

  it('sorting the selected range by Sales ascending reorders the records inside the range only and persists after refresh', async () => {
    const { user, view } = await openEditor();

    selectRange('A1', 'C6');
    const dialog = await openSortDialog(user);
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Sort by' }),
      'Sales'
    );
    await user.click(within(dialog).getByRole('button', { name: 'Sort' }));

    // dialog closes after a successful sort
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Sort range' })).toBeNull()
    );

    // Header row does not participate and stays first
    expect(screen.getByRole('gridcell', { name: 'A1' })).toHaveTextContent('Region');
    expect(screen.getByRole('gridcell', { name: 'B1' })).toHaveTextContent('Sales');
    expect(screen.getByRole('gridcell', { name: 'C1' })).toHaveTextContent('Status');
    // Sales ascending: 700 (South), 800 (North), 1200 (East)
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('South');
    expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveTextContent('700');
    expect(screen.getByRole('gridcell', { name: 'C2' })).toHaveTextContent('Open');
    expect(screen.getByRole('gridcell', { name: 'A3' })).toHaveTextContent('North');
    expect(screen.getByRole('gridcell', { name: 'B3' })).toHaveTextContent('800');
    expect(screen.getByRole('gridcell', { name: 'C3' })).toHaveTextContent('Closed');
    expect(screen.getByRole('gridcell', { name: 'A4' })).toHaveTextContent('East');
    expect(screen.getByRole('gridcell', { name: 'B4' })).toHaveTextContent('1200');
    expect(screen.getByRole('gridcell', { name: 'C4' })).toHaveTextContent('Open');
    // Data outside the selection remains unchanged
    expect(screen.getByRole('gridcell', { name: 'D2' })).toHaveTextContent('outside');

    // The reordered values are persisted
    await waitFor(() => expect(activeSheetCells().A2).toBe('South'));
    expect(activeSheetCells().B4).toBe('1200');
    expect(activeSheetCells().D2).toBe('outside');

    // Refresh: the same order remains visible
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('gridcell', { name: 'A1' })).toHaveTextContent('Region');
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('South');
    expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveTextContent('700');
    expect(screen.getByRole('gridcell', { name: 'A3' })).toHaveTextContent('North');
    expect(screen.getByRole('gridcell', { name: 'A4' })).toHaveTextContent('East');
    expect(screen.getByRole('gridcell', { name: 'B4' })).toHaveTextContent('1200');
    expect(screen.getByRole('gridcell', { name: 'D2' })).toHaveTextContent('outside');
  });

  it('sorting descending by Sales puts the largest value first and keeps the header on top', async () => {
    const { user, view } = await openEditor();

    selectRange('A1', 'C6');
    const dialog = await openSortDialog(user);
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Sort by' }),
      'Sales'
    );
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Order' }),
      'Descending'
    );
    await user.click(within(dialog).getByRole('button', { name: 'Sort' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Sort range' })).toBeNull()
    );

    expect(screen.getByRole('gridcell', { name: 'A1' })).toHaveTextContent('Region');
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('East');
    expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveTextContent('1200');
    expect(screen.getByRole('gridcell', { name: 'A3' })).toHaveTextContent('North');
    expect(screen.getByRole('gridcell', { name: 'B3' })).toHaveTextContent('800');
    expect(screen.getByRole('gridcell', { name: 'A4' })).toHaveTextContent('South');
    expect(screen.getByRole('gridcell', { name: 'B4' })).toHaveTextContent('700');

    // refresh keeps the descending order
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('East');
    expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveTextContent('1200');
    expect(screen.getByRole('gridcell', { name: 'A4' })).toHaveTextContent('South');
  });

  it('unchecking Data has header row lets the header participate in sorting', async () => {
    const { user } = await openEditor();

    selectRange('A1', 'C6');
    const dialog = await openSortDialog(user);
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Sort by' }),
      'Sales'
    );
    await user.click(within(dialog).getByRole('checkbox', { name: 'Data has header row' }));
    await user.click(within(dialog).getByRole('button', { name: 'Sort' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Sort range' })).toBeNull()
    );

    // Sales ascending: numeric rows first (South/North/East), then the
    // header record (text "Sales") participates in the data rows and
    // sorts after the numbers; the sorted records start at row 1
    expect(screen.getByRole('gridcell', { name: 'A1' })).toHaveTextContent('South');
    expect(screen.getByRole('gridcell', { name: 'B1' })).toHaveTextContent('700');
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('North');
    expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveTextContent('800');
    expect(screen.getByRole('gridcell', { name: 'A3' })).toHaveTextContent('East');
    expect(screen.getByRole('gridcell', { name: 'B3' })).toHaveTextContent('1200');
    expect(screen.getByRole('gridcell', { name: 'A4' })).toHaveTextContent('Region');
    expect(screen.getByRole('gridcell', { name: 'B4' })).toHaveTextContent('Sales');
  });

  it('a failed save shows an error and the grid retains its original order', async () => {
    const { user } = await openEditor();

    selectRange('A1', 'C6');
    const dialog = await openSortDialog(user);
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Sort by' }),
      'Sales'
    );
    server.failNextSave = true;
    await user.click(within(dialog).getByRole('button', { name: 'Sort' }));

    // The error is displayed inside the dialog and the grid keeps the
    // original seeded order
    await waitFor(() =>
      expect(within(dialog).getByRole('alert')).toHaveTextContent('Save failed')
    );
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('East');
    expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveTextContent('1200');
    expect(screen.getByRole('gridcell', { name: 'A3' })).toHaveTextContent('North');
    expect(screen.getByRole('gridcell', { name: 'B3' })).toHaveTextContent('800');
    expect(screen.getByRole('gridcell', { name: 'A4' })).toHaveTextContent('South');
    expect(screen.getByRole('gridcell', { name: 'B4' })).toHaveTextContent('700');
    expect(activeSheetCells().A2).toBe('East');
  });

  it('sorting keeps filter views and validation rules attached to the same selected range', async () => {
    const wb = server.workbooks.get('q3-sales')!;
    wb.sheets[0].filterViews = [
      {
        id: 'fv1',
        name: 'Filter view 1',
        range: 'A1:C6',
        criteria: [{ column: 1, condition: 'greater-than', value: '900' }],
      },
    ];
    wb.sheets[0].validationRules = [
      {
        id: 'vr1',
        range: 'B2:B4',
        type: 'number',
        min: 0,
        max: 100,
      },
    ];
    // The persisted selection rectangle is A1:C6; the editor restores it
    // on load (the filter hides rows 3-4, so the range cannot be re-dragged).
    wb.sheets[0].selection = { anchor: 'A1', active: 'C6' };

    const { user } = await openEditor();
    // the active filter hides North/South (Sales <= 900)
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('East');
    expect(screen.queryByRole('gridcell', { name: 'A3' })).toBeNull();
    expect(screen.queryByRole('gridcell', { name: 'A4' })).toBeNull();

    const dialog = await openSortDialog(user);
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Sort by' }),
      'Sales'
    );
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Order' }),
      'Descending'
    );
    await user.click(within(dialog).getByRole('button', { name: 'Sort' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Sort range' })).toBeNull()
    );

    // The same range is sorted (East/1200 now first), the filter view and
    // validation rule keep applying to the same selected range A1:C6
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('East');
    expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveTextContent('1200');
    expect(screen.getByRole('button', { name: 'Filter Region' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Filter Sales' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Filter Status' })).toBeTruthy();
    const persisted = server.workbooks.get('q3-sales')!;
    const sheet = persisted.sheets[0];
    expect(sheet.filterViews[0].range).toBe('A1:C6');
    expect(sheet.validationRules[0].range).toBe('B2:B4');
    expect(sheet.validationRules[0]).toMatchObject({ type: 'number', min: 0, max: 100 });
  });
});
