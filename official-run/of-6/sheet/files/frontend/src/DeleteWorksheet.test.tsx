import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createMockServer, seedWorkbook, type MockServer } from './test/mockServer';
import type { Workbook } from './types';

// REQ-2-1-4 mirror of the seeded Q3 Sales workbook plus one pivot-result
// worksheet so the delete constraints (pivot source / pivot result) can be
// exercised end to end.
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
        rowCount: 4,
        columnCount: 4,
        cells: { A1: 'Region', A2: 'East', B2: '1200', A3: 'North', B3: '800' },
        filterViews: [],
        validationRules: [],
      },
      {
        id: 'pivot-sheet',
        name: 'Pivot1',
        rowCount: 4,
        columnCount: 4,
        cells: {
          A1: 'Region',
          B1: 'SUM of Sales',
          A2: 'East',
          B2: '1200',
          A3: 'North',
          B3: '800',
          A4: 'Grand Total',
          B4: '2000',
        },
        filterViews: [],
        validationRules: [],
      },
    ],
    pivots: [
      {
        id: 'p1',
        name: 'Pivot1',
        sheetId: 'sheet1',
        resultSheetId: 'pivot-sheet',
        sourceRange: 'A1:C6',
        config: { rowField: 'Region', valueField: 'Sales', summarizeBy: 'SUM' },
      },
    ],
  };
}

describe('REQ-2-1-4 Delete a Worksheet', () => {
  let server: MockServer;
  let workbookId: string;

  beforeEach(() => {
    // Unique workbook id per case so delayed save-queue PUTs from a previous
    // case hit 404 instead of overwriting the fresh seed (mock-harness caveat,
    // see ARCHITECTURE.md).
    workbookId = 'q3-sales-' + Math.random().toString(36).slice(2, 10);
    server = createMockServer([{ ...seedWorkbook(), id: workbookId }]);
    vi.stubGlobal('fetch', server.fetch);
    window.location.hash = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function openEditor() {
    const user = userEvent.setup();
    const view = render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Q3 Sales' }));
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    return { user, view };
  }

  function sheetNames(): string[] {
    return server.workbooks.get(workbookId)!.sheets.map((s) => s.name);
  }

  async function confirmDelete(user: ReturnType<typeof userEvent.setup>, sheetName: string) {
    await user.click(
      screen.getByRole('button', { name: `Worksheet options for ${sheetName}` })
    );
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete worksheet' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete worksheet' }));
  }

  it('the worksheet tab menu provides a Delete command', async () => {
    const { user } = await openEditor();

    await user.click(screen.getByRole('button', { name: 'Worksheet options for Sheet1' }));
    const menu = screen.getByRole('menu', { name: 'Options for Sheet1' });
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toBeTruthy();
  });

  it('Delete opens a dialog named "Delete worksheet" whose visible text includes the target name, with a Delete worksheet confirmation button', async () => {
    const { user } = await openEditor();

    await user.click(screen.getByRole('button', { name: 'Worksheet options for Sheet2' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog', { name: 'Delete worksheet' });
    expect(within(dialog).getByText(/Delete worksheet Sheet2/)).toBeTruthy();
    expect(
      within(dialog).getByRole('button', { name: 'Delete worksheet' })
    ).toBeTruthy();
    // the target tab and its data are still present before confirmation
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sheet2' })).toBeTruthy();
  });

  it('confirming deletes the target worksheet, activates an adjacent worksheet, and the deletion persists after refresh and reopening', async () => {
    const { user, view } = await openEditor();

    // delete the active Sheet1; Sheet2 becomes active
    await confirmDelete(user, 'Sheet1');

    await waitFor(() => expect(sheetNames()).toEqual(['Sheet2']));
    expect(screen.queryByRole('tab', { name: 'Sheet1' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Sheet2' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.queryByRole('dialog', { name: 'Delete worksheet' })).toBeNull();
    // the deleted worksheet's data, filters, validation and pivots are gone
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('');
    expect(screen.getByText('No filter views')).toBeTruthy();
    expect(screen.getByText('No validation rules')).toBeTruthy();
    expect(screen.getByText('No pivot table results')).toBeTruthy();

    // refresh equivalent: remount at the same editor entry keeps the deletion
    const hash = window.location.hash;
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(sheetNames()).toEqual(['Sheet2']);
    expect(screen.queryByRole('tab', { name: 'Sheet1' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Sheet2' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(window.location.hash).toBe(hash);

    // reopening from the home page entry point also keeps the deletion
    await user.click(screen.getByRole('link', { name: 'Back to workbooks' }));
    await user.click(await screen.findByRole('link', { name: 'Q3 Sales' }));
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(sheetNames()).toEqual(['Sheet2']);
    expect(screen.queryByRole('tab', { name: 'Sheet1' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Sheet2' })).toBeTruthy();
  });

  it('deleting the active last worksheet activates the previous adjacent worksheet', async () => {
    const { user } = await openEditor();

    await user.click(screen.getByRole('button', { name: 'Add worksheet' }));
    await screen.findByRole('tab', { name: 'Sheet3' });
    await waitFor(() => expect(sheetNames()).toEqual(['Sheet1', 'Sheet2', 'Sheet3']));

    await confirmDelete(user, 'Sheet3');

    await waitFor(() => expect(sheetNames()).toEqual(['Sheet1', 'Sheet2']));
    expect(screen.queryByRole('tab', { name: 'Sheet3' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Sheet2' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    // the remaining worksheets keep their data
    await user.click(screen.getByRole('tab', { name: 'Sheet1' }));
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('1200');
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('North');
    expect(screen.getByRole('textbox', { name: 'B3' })).toHaveValue('800');
  });

  it('deleting an inactive worksheet keeps the active worksheet and its grid values', async () => {
    const { user } = await openEditor();

    await confirmDelete(user, 'Sheet2');

    await waitFor(() => expect(sheetNames()).toEqual(['Sheet1']));
    expect(screen.queryByRole('tab', { name: 'Sheet2' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('1200');
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('North');
    expect(screen.getByRole('textbox', { name: 'B3' })).toHaveValue('800');
  });

  it('deleting a pivot-result worksheet removes its pivot record so the source worksheet is no longer constrained', async () => {
    server = createMockServer([pivotSeedWorkbook(workbookId)]);
    vi.stubGlobal('fetch', server.fetch);
    window.location.hash = '';
    const { user } = await openEditor();

    await user.click(screen.getByRole('tab', { name: 'Pivot1' }));
    await confirmDelete(user, 'Pivot1');

    await waitFor(() => {
      const wb = server.workbooks.get(workbookId)!;
      expect(wb.sheets.map((s) => s.name)).toEqual(['Sheet1']);
      expect(wb.pivots).toEqual([]);
    });
    expect(screen.queryByRole('tab', { name: 'Pivot1' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    // the source worksheet no longer lists the deleted pivot result
    expect(screen.getByText('No pivot table results')).toBeTruthy();
  });

  it('rejects deleting a worksheet that is still a pivot source; the dialog closes and both worksheets remain unchanged', async () => {
    server = createMockServer([pivotSeedWorkbook(workbookId)]);
    vi.stubGlobal('fetch', server.fetch);
    window.location.hash = '';
    const { user } = await openEditor();

    await user.click(screen.getByRole('button', { name: 'Worksheet options for Sheet1' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete worksheet' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete worksheet' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please delete or rebuild dependent pivot tables first'
    );
    expect(screen.queryByRole('dialog', { name: 'Delete worksheet' })).toBeNull();

    const wb = server.workbooks.get(workbookId)!;
    expect(wb.sheets.map((s) => s.name)).toEqual(['Sheet1', 'Pivot1']);
    expect(wb.pivots).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Pivot1' })).toBeTruthy();
    // source data and pivot results remain unchanged
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('1200');
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('North');
    expect(screen.getByRole('textbox', { name: 'B3' })).toHaveValue('800');
    expect(screen.getByText('Pivot1 (A1:C6)')).toBeTruthy();
  });

  it('when only one worksheet remains, Delete does not open a dialog and displays the required error', async () => {
    const single: Workbook = {
      id: 'single-sheet',
      name: 'Q3 Sales',
      lastUpdated: '2026-09-25T10:00:00.000Z',
      activeSheetId: 'sheet1',
      sheets: [
        {
          id: 'sheet1',
          name: 'Sheet1',
          rowCount: 4,
          columnCount: 4,
          cells: { A1: 'Region', A2: 'East', B2: '1200', A3: 'North', B3: '800' },
          filterViews: [],
          validationRules: [],
        },
      ],
      pivots: [],
    };
    server = createMockServer([single]);
    vi.stubGlobal('fetch', server.fetch);
    window.location.hash = '';
    const { user } = await openEditor();

    await user.click(screen.getByRole('button', { name: 'Worksheet options for Sheet1' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(screen.queryByRole('dialog', { name: 'Delete worksheet' })).toBeNull();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A workbook must contain at least one worksheet'
    );
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('East');
  });

  it('when deletion fails an error is shown and the target tab and grid remain visible and unchanged after refresh', async () => {
    const { user, view } = await openEditor();

    await user.click(screen.getByRole('button', { name: 'Worksheet options for Sheet2' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete worksheet' });

    server.failNextSave = true;
    await user.click(within(dialog).getByRole('button', { name: 'Delete worksheet' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
    await waitFor(() => expect(sheetNames()).toEqual(['Sheet1', 'Sheet2']));
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sheet2' })).toBeTruthy();

    // refresh keeps the unchanged state (target tab and grid remain)
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(sheetNames()).toEqual(['Sheet1', 'Sheet2']);
    expect(screen.getByRole('tab', { name: 'Sheet2' })).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Sheet1' }));
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('1200');
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('North');
    expect(screen.getByRole('textbox', { name: 'B3' })).toHaveValue('800');
  });
});
