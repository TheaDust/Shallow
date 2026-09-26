import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createMockServer, type MockServer } from './test/mockServer';
import type { Workbook } from './types';

// The REQ-5-1-2 evaluation seed: seeded worksheet range A1:C6 with headers
// Region/Sales/Status and rows East/1200/Open, North/800/Closed,
// South/700/Open.
function filterSeedWorkbook(): Workbook {
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

describe('REQ-5-1-2 Filter Rows by Value or Condition', () => {
  let server: MockServer;
  let createObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    server = createMockServer([filterSeedWorkbook()]);
    vi.stubGlobal('fetch', server.fetch);
    window.location.hash = '';
    createObjectURL = vi.fn(() => 'blob:mock-url');
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURL,
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function activeSheetFilterViews() {
    const wb = server.workbooks.get('q3-sales')!;
    const sheet = wb.sheets.find((s) => s.id === wb.activeSheetId) ?? wb.sheets[0];
    return sheet.filterViews;
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

  async function createFilterOnA1C6(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Data' }));
    await user.click(screen.getByRole('menuitem', { name: 'Create filter' }));
    await waitFor(() =>
      expect(activeSheetFilterViews()).toHaveLength(1)
    );
  }

  async function lastDownloadText(): Promise<string> {
    const calls = createObjectURL.mock.calls;
    const blob = calls[calls.length - 1][0] as Blob;
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
      reader.readAsText(blob, 'UTF-8');
    });
  }

  function captureDownloadAnchor(): { anchor: () => HTMLAnchorElement | null; restore: () => void } {
    let captured: HTMLAnchorElement | null = null;
    const spy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        captured = this;
        return undefined;
      });
    return {
      anchor: () => captured,
      restore: () => spy.mockRestore(),
    };
  }

  it('the editor toolbar provides a Data button whose menu contains Create filter and Clear filter menuitems', async () => {
    const { user } = await openEditor();

    const toolbar = screen.getByRole('toolbar', { name: 'Workbook toolbar' });
    const dataButton = screen.getByRole('button', { name: 'Data' });
    expect(toolbar.contains(dataButton)).toBe(true);
    expect(dataButton).toHaveAttribute('aria-haspopup', 'menu');
    expect(dataButton).toHaveAttribute('aria-expanded', 'false');

    await user.click(dataButton);
    expect(dataButton).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu', { name: 'Data menu' });
    expect(within(menu).getByRole('menuitem', { name: 'Create filter' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Clear filter' })).toBeTruthy();
  });

  it('creating a filter on the selected range exposes Filter <header text> buttons and a value filter hides nonmatching rows, persisted across refresh', async () => {
    const { user, view } = await openEditor();

    selectRange('A1', 'C6');
    await createFilterOnA1C6(user);

    // Each header provides a button with the accessible name "Filter <header text>"
    expect(screen.getByRole('button', { name: 'Filter Region' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Filter Sales' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Filter Status' })).toBeTruthy();
    expect(activeSheetFilterViews()[0].range).toBe('A1:C6');

    // Open the value filter dialog for Region
    await user.click(screen.getByRole('button', { name: 'Filter Region' }));
    const dialog = screen.getByRole('dialog', { name: 'Filter Region' });
    expect(within(dialog).getByRole('button', { name: 'Clear selection' })).toBeTruthy();
    const east = within(dialog).getByRole('checkbox', { name: 'East' });
    const north = within(dialog).getByRole('checkbox', { name: 'North' });
    const south = within(dialog).getByRole('checkbox', { name: 'South' });
    expect(east).toBeChecked();
    expect(north).toBeChecked();
    expect(south).toBeChecked();
    const applyButtons = within(dialog).getAllByRole('button', { name: 'Apply' });
    expect(applyButtons).toHaveLength(2);

    // Keep only East
    await user.click(north);
    await user.click(south);
    await user.click(applyButtons[0]);

    // Nonmatching rows are hidden only: row 2 stays, rows 3/4 disappear
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('East');
    expect(screen.queryByRole('gridcell', { name: 'A3' })).toBeNull();
    expect(screen.queryByRole('gridcell', { name: 'A4' })).toBeNull();
    expect(screen.queryByRole('rowheader', { name: '3' })).toBeNull();
    expect(screen.queryByRole('rowheader', { name: '4' })).toBeNull();

    // Persisted with the range and the value criterion
    await waitFor(() =>
      expect(activeSheetFilterViews()[0].criteria).toEqual([
        { column: 0, selectedValues: ['East'] },
      ])
    );

    // Refresh (remount at the same entry): the same rows remain visible and
    // the underlying data is untouched (hidden, not deleted).
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('East');
    expect(screen.queryByRole('gridcell', { name: 'A3' })).toBeNull();
    expect(screen.queryByRole('gridcell', { name: 'A4' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Filter Region' })).toBeTruthy();
    const wb = server.workbooks.get('q3-sales')!;
    const sheet = wb.sheets.find((s) => s.id === wb.activeSheetId)!;
    expect(sheet.cells.A3).toBe('North');
    expect(sheet.cells.B3).toBe('800');
  });

  it('CSV export still includes the hidden rows within the filtered range', async () => {
    const { user } = await openEditor();

    selectRange('A1', 'C6');
    await createFilterOnA1C6(user);

    await user.click(screen.getByRole('button', { name: 'Filter Region' }));
    const dialog = screen.getByRole('dialog', { name: 'Filter Region' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'North' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'South' }));
    await user.click(within(dialog).getAllByRole('button', { name: 'Apply' })[0]);

    expect(screen.queryByRole('gridcell', { name: 'A3' })).toBeNull();

    const capture = captureDownloadAnchor();
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(capture.anchor()?.download.endsWith('.csv')).toBe(true);
    const text = await lastDownloadText();
    capture.restore();
    expect(text).toContain('Region,Sales,Status');
    expect(text).toContain('East,1200,Open');
    expect(text).toContain('North,800,Closed');
    expect(text).toContain('South,700,Open');
  });

  it('condition filters combine with AND and persist after refresh', async () => {
    const { user, view } = await openEditor();

    selectRange('A1', 'C6');
    await createFilterOnA1C6(user);

    // Sales greater than 900
    await user.click(screen.getByRole('button', { name: 'Filter Sales' }));
    let dialog = screen.getByRole('dialog', { name: 'Filter Sales' });
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Condition' }),
      'Greater than'
    );
    await user.type(within(dialog).getByRole('textbox', { name: 'Value' }), '900');
    await user.click(within(dialog).getAllByRole('button', { name: 'Apply' })[1]);

    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('East');
    expect(screen.queryByRole('gridcell', { name: 'A3' })).toBeNull();
    expect(screen.queryByRole('gridcell', { name: 'A4' })).toBeNull();
    await waitFor(() =>
      expect(activeSheetFilterViews()[0].criteria).toEqual([
        { column: 1, condition: 'greater-than', value: '900' },
      ])
    );

    // AND: additionally keep only Region East -> row 2 stays
    await user.click(screen.getByRole('button', { name: 'Filter Region' }));
    dialog = screen.getByRole('dialog', { name: 'Filter Region' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'North' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'South' }));
    await user.click(within(dialog).getAllByRole('button', { name: 'Apply' })[0]);

    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('East');
    expect(screen.queryByRole('gridcell', { name: 'A3' })).toBeNull();
    expect(screen.queryByRole('gridcell', { name: 'A4' })).toBeNull();
    // criteria keep the order in which they were applied (column 1 first, then 0)
    await waitFor(() =>
      expect(activeSheetFilterViews()[0].criteria).toEqual([
        { column: 1, condition: 'greater-than', value: '900' },
        { column: 0, selectedValues: ['East'] },
      ])
    );

    // refresh keeps the same visible rows
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('East');
    expect(screen.queryByRole('gridcell', { name: 'A3' })).toBeNull();
    expect(screen.queryByRole('gridcell', { name: 'A4' })).toBeNull();
  });

  it('Is empty condition hides non-empty rows and keeps empty rows visible', async () => {
    // Status C2/C4 are Open, C3 is Closed; add an empty Status row at row 5
    const wb = server.workbooks.get('q3-sales')!;
    wb.sheets[0].cells.A5 = 'West';
    wb.sheets[0].cells.B5 = '900';

    const { user } = await openEditor();

    selectRange('A1', 'C6');
    await createFilterOnA1C6(user);

    await user.click(screen.getByRole('button', { name: 'Filter Status' }));
    const dialog = screen.getByRole('dialog', { name: 'Filter Status' });
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Condition' }),
      'Is empty'
    );
    // Is empty requires no value: the Value text box is absent
    expect(within(dialog).queryByRole('textbox', { name: 'Value' })).toBeNull();
    await user.click(within(dialog).getAllByRole('button', { name: 'Apply' })[1]);

    // rows 2-4 have a Status value and are hidden; row 5 (empty Status) stays
    expect(screen.queryByRole('gridcell', { name: 'A2' })).toBeNull();
    expect(screen.queryByRole('gridcell', { name: 'A3' })).toBeNull();
    expect(screen.queryByRole('gridcell', { name: 'A4' })).toBeNull();
    expect(screen.getByRole('gridcell', { name: 'A5' })).toHaveTextContent('West');
  });

  it('Clear filter restores all source records in their original order and values after refresh', async () => {
    const { user, view } = await openEditor();

    selectRange('A1', 'C6');
    await createFilterOnA1C6(user);

    // hide North and South
    await user.click(screen.getByRole('button', { name: 'Filter Region' }));
    const dialog = screen.getByRole('dialog', { name: 'Filter Region' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'North' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'South' }));
    await user.click(within(dialog).getAllByRole('button', { name: 'Apply' })[0]);
    expect(screen.queryByRole('gridcell', { name: 'A3' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Data' }));
    await user.click(screen.getByRole('menuitem', { name: 'Clear filter' }));

    // all records visible again, in the original order and with original values
    const cells = screen.getAllByRole('gridcell');
    const gridText = cells.map((c) => c.textContent ?? '').join('|');
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('East');
    expect(screen.getByRole('gridcell', { name: 'A3' })).toHaveTextContent('North');
    expect(screen.getByRole('gridcell', { name: 'A4' })).toHaveTextContent('South');
    expect(gridText.indexOf('East') < gridText.indexOf('North')).toBe(true);
    expect(gridText.indexOf('North') < gridText.indexOf('South')).toBe(true);
    expect(screen.getByRole('gridcell', { name: 'B3' })).toHaveTextContent('800');
    expect(activeSheetFilterViews()).toHaveLength(0);

    // after refresh all remain visible
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('East');
    expect(screen.getByRole('gridcell', { name: 'A3' })).toHaveTextContent('North');
    expect(screen.getByRole('gridcell', { name: 'A4' })).toHaveTextContent('South');
    expect(screen.queryByRole('button', { name: 'Filter Region' })).toBeNull();
  });
});
