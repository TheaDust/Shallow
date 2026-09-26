import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createMockServer, seedWorkbook, type MockServer } from './test/mockServer';
import type { Workbook } from './types';

// The REQ-2-1-2 evaluation seed: workbook `Q3 Sales` with `Sheet1` and
// `Sheet2` and rows `East/1200` and `North/800`. The standard mock seed
// mirrors it (rows in Sheet1); Sheet2 additionally gets distinct content so
// switching can never be confused with data from another worksheet.
function twoSheetSeed(): Workbook {
  const wb = seedWorkbook();
  wb.sheets[1].cells = { A1: 'Item', A2: 'Pen', B2: '4' };
  return wb;
}

// Every test seeds its workbook under a unique id. The editor's saves are
// fire-and-forget through a serialized queue, and a save deferred from a
// previous test would otherwise overwrite the next scenario's seed (the
// editor save queue is session-scoped, so this is purely a test-harness
// concern; in the real app the PUT target never changes between scenarios).
let seedCounter = 0;
function seedForNextTest(mutate: (wb: Workbook) => void = () => undefined): {
  id: string;
  wb: Workbook;
} {
  seedCounter += 1;
  const id = 'q3-sales-' + seedCounter;
  const wb = twoSheetSeed();
  wb.id = id;
  mutate(wb);
  return { id, wb };
}

function workbookOf(server: MockServer, id: string): Workbook {
  return server.workbooks.get(id)!;
}

describe('REQ-2-1-2 Switch Worksheets', () => {
  let server: MockServer;

  beforeEach(() => {
    server = createMockServer();
    vi.stubGlobal('fetch', server.fetch);
    window.location.hash = '';
  });

  afterEach(async () => {
    // Let any fire-and-forget save queue drain while the current mock fetch
    // is still installed so a deferred PUT cannot hit the next scenario.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    vi.unstubAllGlobals();
  });

  async function openEditor() {
    const user = userEvent.setup();
    const view = render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Q3 Sales' }));
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    return { user, view };
  }

  it('clicking another ARIA tab switches grid, formula bar and selected cell; returning restores the source worksheet without modifying it', async () => {
    const { id, wb } = seedForNextTest();
    server.workbooks.set(id, wb);
    const { user } = await openEditor();

    // Sheet1 is the active tab with A1 selected; the formula bar shows the
    // selected cell's ordinary value.
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('gridcell', { name: 'A1' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('Region');

    // Select A2 on Sheet1 -> formula bar follows the selected cell.
    await user.click(screen.getByRole('gridcell', { name: 'A2' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('East');

    // Click the Sheet2 ARIA tab: grid, formula bar and selection switch to
    // Sheet2's state (Sheet2 has no selection history, so A1 is selected).
    await user.click(screen.getByRole('tab', { name: 'Sheet2' }));
    expect(screen.getByRole('tab', { name: 'Sheet2' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    expect(screen.getByRole('gridcell', { name: 'A1' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Item');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('Pen');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('4');
    // Sheet1's rows (East/1200, North/800) are not displayed on Sheet2.
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'B3' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('Item');

    // Enter a value into Sheet2's B3 through the labelled grid input.
    await user.type(screen.getByRole('textbox', { name: 'B3' }), '5');
    await waitFor(() => expect(workbookOf(server, id).sheets[1].cells.B3).toBe('5'));

    // Switch back to Sheet1: its most recent successful state is restored
    // (data and the A2 selection) and it was never modified by the switch.
    await user.click(screen.getByRole('tab', { name: 'Sheet1' }));
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('1200');
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('North');
    expect(screen.getByRole('textbox', { name: 'B3' })).toHaveValue('800');
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('East');

    await waitFor(() => {
      const wbCurrent = workbookOf(server, id);
      expect(wbCurrent.sheets[0].cells.A1).toBe('Region');
      expect(wbCurrent.sheets[0].cells.A2).toBe('East');
      expect(wbCurrent.sheets[0].cells.B2).toBe('1200');
      expect(wbCurrent.sheets[0].cells.A3).toBe('North');
      expect(wbCurrent.sheets[0].cells.B3).toBe('800');
      expect(wbCurrent.sheets[1].cells.B3).toBe('5');
      expect(wbCurrent.activeSheetId).toBe(wbCurrent.sheets[0].id);
    });
  });

  it('the formula bar displays the ordinary value or the original formula of the selected cell on each worksheet', async () => {
    const { id, wb } = seedForNextTest((w) => {
      w.sheets[0].cells.C2 = '=B2*2'; // computes 2400 from B2=1200
    });
    server.workbooks.set(id, wb);
    const { user } = await openEditor();

    // Selecting the formula cell shows the computed result in the grid but
    // the original formula text in the formula bar.
    await user.click(screen.getByRole('gridcell', { name: 'C2' }));
    expect(screen.getByRole('gridcell', { name: 'C2' })).toHaveTextContent('2400');
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=B2*2');

    // Sheet2's selected cell (A1) holds an ordinary value.
    await user.click(screen.getByRole('tab', { name: 'Sheet2' }));
    expect(screen.getByRole('gridcell', { name: 'A1' })).toHaveTextContent('Item');
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('Item');

    // Returning to Sheet1 restores the selected C2 with its original formula.
    await user.click(screen.getByRole('tab', { name: 'Sheet1' }));
    expect(screen.getByRole('gridcell', { name: 'C2' })).toHaveTextContent('2400');
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=B2*2');
    await waitFor(() =>
      expect(workbookOf(server, id).activeSheetId).toBe(workbookOf(server, id).sheets[0].id)
    );
  });

  it('a worksheet opened for the first time with no selection history selects A1', async () => {
    const { id, wb } = seedForNextTest();
    server.workbooks.set(id, wb);
    const { user } = await openEditor();

    // Sheet1 selects A3.
    await user.click(screen.getByRole('gridcell', { name: 'A3' }));
    expect(screen.getByRole('gridcell', { name: 'A3' })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    // Sheet2 has never been selected: switching to it selects A1.
    await user.click(screen.getByRole('tab', { name: 'Sheet2' }));
    expect(screen.getByRole('gridcell', { name: 'A1' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('gridcell', { name: 'A3' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('Item');
    // drain the tab-switch save before the test ends
    await waitFor(() =>
      expect(workbookOf(server, id).activeSheetId).toBe(workbookOf(server, id).sheets[1].id)
    );
  });

  it('filter buttons, validation entry points and pivot table results switch to the target worksheet state', async () => {
    const { id, wb } = seedForNextTest((w) => {
      w.sheets[0].cells.B1 = 'Sales';
      w.sheets[0].filterViews = [
        { id: 'fv1', name: 'Filter view 1', range: 'A1:B3', criteria: [] },
      ];
      w.sheets[0].validationRules = [
        { id: 'vr1', range: 'A2:B2', type: 'dropdown', values: ['East', 'North'] },
      ];
      w.pivots = [
        { id: 'p1', name: 'Sales pivot', sheetId: w.sheets[0].id, sourceRange: 'A1:B4' },
      ];
    });
    server.workbooks.set(id, wb);
    const { user } = await openEditor();

    // Sheet1 shows its own filter buttons, validation entry points and pivot.
    expect(screen.getByRole('button', { name: 'Filter Region' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Filter Sales' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open dropdown for A2' })).toBeTruthy();
    expect(screen.getByText('A2:B2 (dropdown, East, North)')).toBeTruthy();
    expect(screen.getByText('Sales pivot (A1:B4)')).toBeTruthy();

    // Sheet2 has none of Sheet1's filters, validation or pivot results.
    await user.click(screen.getByRole('tab', { name: 'Sheet2' }));
    expect(screen.queryByRole('button', { name: 'Filter Region' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Filter Sales' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open dropdown for A2' })).toBeNull();
    expect(screen.getByText('No filter views')).toBeTruthy();
    expect(screen.getByText('No validation rules')).toBeTruthy();
    expect(screen.getByText('No pivot table results')).toBeTruthy();

    // Returning restores them.
    await user.click(screen.getByRole('tab', { name: 'Sheet1' }));
    expect(screen.getByRole('button', { name: 'Filter Region' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open dropdown for A2' })).toBeTruthy();
    expect(screen.getByText('A2:B2 (dropdown, East, North)')).toBeTruthy();
    expect(screen.getByText('Sales pivot (A1:B4)')).toBeTruthy();
    await waitFor(() =>
      expect(workbookOf(server, id).activeSheetId).toBe(workbookOf(server, id).sheets[0].id)
    );
  });

  it('reopening the workbook displays the last active tab and restores the last confirmed selected cell for each worksheet', async () => {
    const { id, wb } = seedForNextTest();
    server.workbooks.set(id, wb);
    const { user, view } = await openEditor();

    // Sheet1: confirm selection A3 (North).
    await user.click(screen.getByRole('gridcell', { name: 'A3' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('North');

    // Sheet2: confirm selection B2 (4).
    await user.click(screen.getByRole('tab', { name: 'Sheet2' }));
    await user.click(screen.getByRole('gridcell', { name: 'B2' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('4');

    // End on Sheet1 (the last active tab) with A3 selected.
    await user.click(screen.getByRole('tab', { name: 'Sheet1' }));
    expect(screen.getByRole('gridcell', { name: 'A3' })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    await waitFor(() => {
      const wbCurrent = workbookOf(server, id);
      expect(wbCurrent.activeSheetId).toBe(wbCurrent.sheets[0].id);
      expect(wbCurrent.sheets[0].selection).toEqual({ anchor: 'A3', active: 'A3' });
      expect(wbCurrent.sheets[1].selection).toEqual({ anchor: 'B2', active: 'B2' });
    });

    // Refresh equivalent: remount at the same editor entry. The last active
    // tab (Sheet1) is shown and its last confirmed selection is restored.
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('gridcell', { name: 'A3' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('North');

    // Switching to Sheet2 restores its last confirmed selected cell.
    await user.click(screen.getByRole('tab', { name: 'Sheet2' }));
    expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('4');

    // Reopening from the home entry point shows the last active tab (Sheet2)
    // with Sheet2's confirmed selection.
    await user.click(screen.getByRole('link', { name: 'Back to workbooks' }));
    await user.click(await screen.findByRole('link', { name: 'Q3 Sales' }));
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('tab', { name: 'Sheet2' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('4');

    // And Sheet1 still restores its own confirmed selection.
    await user.click(screen.getByRole('tab', { name: 'Sheet1' }));
    expect(screen.getByRole('gridcell', { name: 'A3' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('North');
    await waitFor(() =>
      expect(workbookOf(server, id).activeSheetId).toBe(workbookOf(server, id).sheets[0].id)
    );
  });
});
