import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createMockServer, seedWorkbook, cellsOf, type MockServer } from './test/mockServer';
import type { Workbook } from './types';

// The REQ-3-2-2 evaluation seed: seeded workbook Q3 Sales, range A1:B2
// containing Item/Qty and Pen/4, target range D1:E2 (empty).
function undoRedoSeedWorkbook(extra?: Partial<Workbook['sheets'][number]>): Workbook {
  return {
    id: 'q3-sales',
    name: 'Q3 Sales',
    lastUpdated: '2026-09-25T10:00:00.000Z',
    activeSheetId: 'sheet1',
    sheets: [
      {
        id: 'sheet1',
        name: 'Sheet1',
        rowCount: 20,
        columnCount: 6,
        cells: { A1: 'Item/Qty', A2: 'Pen/4' },
        filterViews: [],
        validationRules: [],
        ...extra,
      },
    ],
    pivots: [],
  };
}

function secondWorkbook(): Workbook {
  return {
    id: 'wb2',
    name: 'Second Book',
    lastUpdated: '2026-09-25T10:00:00.000Z',
    activeSheetId: 'sheet1',
    sheets: [
      {
        id: 'sheet1',
        name: 'Sheet1',
        rowCount: 20,
        columnCount: 6,
        cells: { A1: 'Keep', B1: 'Me' },
        filterViews: [],
        validationRules: [],
      },
    ],
    pivots: [],
  };
}

describe('REQ-3-2-2 Undo and Redo Recent Operations', () => {
  let server: MockServer;

  beforeEach(() => {
    server = createMockServer([undoRedoSeedWorkbook()]);
    vi.stubGlobal('fetch', server.fetch);
    window.location.hash = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function openEditor(workbookName = 'Q3 Sales') {
    const user = userEvent.setup();
    const view = render(<App />);
    await user.click(await screen.findByRole('link', { name: workbookName }));
    await screen.findByRole('heading', { name: workbookName });
    return { user, view };
  }

  function undoButton() {
    return screen.getByRole('button', { name: 'Undo' });
  }

  function redoButton() {
    return screen.getByRole('button', { name: 'Redo' });
  }

  const pasteEvent = () =>
    fireEvent.paste(screen.getByRole('grid'), {
      clipboardData: { getData: (type: string) => (type === 'text' ? 'ignored' : '') },
    });

  const paste2DEvent = () =>
    fireEvent.paste(screen.getByRole('grid'), {
      clipboardData: {
        getData: (type: string) =>
          type === 'text' ? 'East\t1200\nNorth\t800' : '',
      },
    });

  it('the toolbar provides Undo and Redo buttons that start disabled and become available after an operation', async () => {
    const { user } = await openEditor();

    const toolbar = screen.getByRole('toolbar', { name: 'Workbook toolbar' });
    expect(toolbar.contains(undoButton())).toBe(true);
    expect(toolbar.contains(redoButton())).toBe(true);
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeDisabled();

    // one cell edit enables Undo but not Redo
    const d1 = screen.getByRole('textbox', { name: 'D1' });
    await user.click(d1);
    await user.type(d1, 'East');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').D1).toBe('East'));
    expect(undoButton()).toBeEnabled();
    expect(redoButton()).toBeDisabled();

    // undoing enables Redo and disables Undo again
    await user.click(undoButton());
    await waitFor(() => expect(cellsOf(server, 'q3-sales').D1).toBeUndefined());
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('');
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeEnabled();
  });

  it('undo restores the value from before a cell edit and redo reapplies it; the state after each undo/redo persists after refresh', async () => {
    const { user } = await openEditor();

    const d1 = screen.getByRole('textbox', { name: 'D1' });
    await user.click(d1);
    await user.type(d1, 'East');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').D1).toBe('East'));

    // undo: the target cell returns to its pre-operation (empty) state
    await user.click(undoButton());
    await waitFor(() => expect(cellsOf(server, 'q3-sales').D1).toBeUndefined());
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('');
    // the seeded range stays intact
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Item/Qty');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('Pen/4');

    // reopening from the application entry point keeps the undone state
    // (history itself is session-only, so Undo/Redo start disabled again)
    await user.click(screen.getByRole('link', { name: 'Back to workbooks' }));
    await user.click(await screen.findByRole('link', { name: 'Q3 Sales' }));
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('');
    expect(cellsOf(server, 'q3-sales').D1).toBeUndefined();
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Item/Qty');
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeDisabled();

    // type again, undo, then redo reapplies the complete operation
    await user.click(screen.getByRole('textbox', { name: 'D1' }));
    await user.type(screen.getByRole('textbox', { name: 'D1' }), 'East');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').D1).toBe('East'));
    await user.click(undoButton());
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue(''));
    await user.click(redoButton());
    await waitFor(() => expect(cellsOf(server, 'q3-sales').D1).toBe('East'));
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('East');

    // the redone state persists after reopening
    await user.click(screen.getByRole('link', { name: 'Back to workbooks' }));
    await user.click(await screen.findByRole('link', { name: 'Q3 Sales' }));
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('East');
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('East');
    expect(cellsOf(server, 'q3-sales').D1).toBe('East');
  });

  it('consecutive undo operations restore changes in reverse order and redo reapplies them in order', async () => {
    const { user } = await openEditor();

    const d1 = screen.getByRole('textbox', { name: 'D1' });
    await user.click(d1);
    await user.type(d1, 'East');
    const e1 = screen.getByRole('textbox', { name: 'E1' });
    await user.click(e1);
    await user.type(e1, '1200');
    const d2 = screen.getByRole('textbox', { name: 'D2' });
    await user.click(d2);
    await user.type(d2, 'North');
    const e2 = screen.getByRole('textbox', { name: 'E2' });
    await user.click(e2);
    await user.type(e2, '800');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').E2).toBe('800'));

    // undo in reverse order: 800, then North, then 1200, then East
    await user.click(undoButton());
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'E2' })).toHaveValue(''));
    expect(screen.getByRole('textbox', { name: 'D2' })).toHaveValue('North');
    expect(screen.getByRole('textbox', { name: 'E1' })).toHaveValue('1200');
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('East');

    await user.click(undoButton());
    expect(screen.getByRole('textbox', { name: 'D2' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'E1' })).toHaveValue('1200');
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('East');

    await user.click(undoButton());
    expect(screen.getByRole('textbox', { name: 'E1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('East');

    await user.click(undoButton());
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue(''));
    expect(screen.getByRole('textbox', { name: 'E1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'D2' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'E2' })).toHaveValue('');

    // redo reapplies the complete operations in original order
    await user.click(redoButton());
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('East'));
    await user.click(redoButton());
    expect(screen.getByRole('textbox', { name: 'E1' })).toHaveValue('1200');
    await user.click(redoButton());
    expect(screen.getByRole('textbox', { name: 'D2' })).toHaveValue('North');
    await user.click(redoButton());
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'E2' })).toHaveValue('800'));
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('East');

    // the seeded range remains unchanged throughout
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Item/Qty');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('Pen/4');
  });

  it('Ctrl+Z and Ctrl+Y perform the same operations as the Undo and Redo buttons', async () => {
    const { user } = await openEditor();

    const d1 = screen.getByRole('textbox', { name: 'D1' });
    await user.click(d1);
    await user.type(d1, 'East');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').D1).toBe('East'));

    await user.keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue(''));
    expect(cellsOf(server, 'q3-sales').D1).toBeUndefined();

    await user.keyboard('{Control>}y{/Control}');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('East'));
    expect(cellsOf(server, 'q3-sales').D1).toBe('East');
  });

  it('a new modification after an undo disables Redo and Ctrl+Y cannot restore the old branch', async () => {
    const { user } = await openEditor();

    const d1 = screen.getByRole('textbox', { name: 'D1' });
    await user.click(d1);
    await user.type(d1, 'East');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').D1).toBe('East'));

    // undo East, then enter a new value: the old redo branch is discarded
    await user.keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue(''));
    expect(redoButton()).toBeEnabled();

    await user.type(d1, 'North');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').D1).toBe('North'));
    expect(redoButton()).toBeDisabled();

    // Ctrl+Y cannot restore the old branch (East stays replaced by North)
    await user.keyboard('{Control>}y{/Control}');
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('North');
    expect(cellsOf(server, 'q3-sales').D1).toBe('North');

    // but Undo still restores the state before the new modification
    await user.click(undoButton());
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue(''));
  });

  it('undo restores the pre-paste state of a bulk paste and redo reapplies the whole rectangle', async () => {
    const { user, view } = await openEditor();

    // enter values, then paste a 2x2 rectangle onto D1:E2 via the grid paste
    const d1 = screen.getByRole('textbox', { name: 'D1' });
    await user.click(d1);
    await user.type(d1, 'old');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').D1).toBe('old'));

    paste2DEvent();
    await waitFor(() => expect(cellsOf(server, 'q3-sales').E2).toBe('800'));

    // pasted rectangle visible
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'E1' })).toHaveValue('1200');
    expect(screen.getByRole('textbox', { name: 'D2' })).toHaveValue('North');
    expect(screen.getByRole('textbox', { name: 'E2' })).toHaveValue('800');

    // undo returns every target cell to its pre-operation value
    await user.click(undoButton());
    await waitFor(() => expect(cellsOf(server, 'q3-sales').E2).toBeUndefined());
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('old');
    expect(screen.getByRole('textbox', { name: 'E1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'D2' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'E2' })).toHaveValue('');

    // redo reapplies the complete paste
    await user.click(redoButton());
    await waitFor(() => expect(cellsOf(server, 'q3-sales').E2).toBe('800'));
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'D2' })).toHaveValue('North');

    // the redone state persists after refresh
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'E2' })).toHaveValue('800');
  });

  it('undo restores a cut-paste range move (source back, target cleared) and redo reapplies the move', async () => {
    const { user } = await openEditor();

    // move A1:B2 (Item/Qty, Pen/4) to D1:E2 with cut + paste
    fireEvent.mouseDown(screen.getByRole('gridcell', { name: 'A1' }));
    fireEvent.mouseEnter(screen.getByRole('gridcell', { name: 'B2' }));
    fireEvent.mouseUp(window);
    fireEvent.cut(screen.getByRole('grid'), { clipboardData: { setData: () => {} } });
    await user.click(screen.getByRole('textbox', { name: 'D1' }));
    pasteEvent();

    await waitFor(() => expect(cellsOf(server, 'q3-sales').D2).toBe('Pen/4'));
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('Item/Qty');
    expect(screen.getByRole('textbox', { name: 'D2' })).toHaveValue('Pen/4');

    // undo restores the source range and clears the target
    await user.click(undoButton());
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Item/Qty'));
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('Pen/4');
    expect(screen.getByRole('textbox', { name: 'B1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'D2' })).toHaveValue('');

    // redo reapplies the complete move
    await user.click(redoButton());
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue(''));
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('Item/Qty');
    expect(screen.getByRole('textbox', { name: 'D2' })).toHaveValue('Pen/4');
  });

  it('undo restores row/column structure, rule ranges and pivot validity; redo reapplies the structure change', async () => {
    const seed = seedWorkbook();
    seed.sheets[0].validationRules = [
      { id: 'vr1', range: 'B2:C4', type: 'number', min: 0, max: 100 },
    ];
    seed.pivots = [
      { id: 'p1', name: 'Sales pivot', sheetId: seed.sheets[0].id, sourceRange: 'A1:B4' },
    ];
    server.workbooks.set('q3-sales', seed);
    const { user, view } = await openEditor();

    // insert a row above row 2 (structure change overlapping the pivot)
    fireEvent.contextMenu(screen.getByRole('rowheader', { name: '2' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Insert 1 row above' }));
    await waitFor(() => {
      const sheet = server.workbooks.get('q3-sales')!.sheets[0];
      expect(sheet.rowCount).toBe(5);
      expect(sheet.cells.A3).toBe('East');
      expect(sheet.validationRules[0].range).toBe('B3:C5');
    });
    const pivot = server.workbooks.get('q3-sales')!.pivots[0];
    expect(pivot.stale).toBe(true);
    expect(screen.getByRole('button', { name: 'Refresh pivot table' })).toBeTruthy();

    // undo restores the original row structure, rule range and pivot validity
    await user.click(undoButton());
    await waitFor(() => {
      const sheet = server.workbooks.get('q3-sales')!.sheets[0];
      expect(sheet.rowCount).toBe(4);
      expect(sheet.cells.A2).toBe('East');
      expect(sheet.cells.A3).toBe('North');
      expect(sheet.validationRules[0].range).toBe('B2:C4');
      const p = server.workbooks.get('q3-sales')!.pivots[0];
      expect(p.sourceRange).toBe('A1:B4');
      expect(p.stale).toBeUndefined();
    });
    expect(screen.queryByRole('button', { name: 'Refresh pivot table' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('East');
    expect(screen.getByText('B2:C4 (number, 0 to 100)')).toBeTruthy();

    // redo reapplies the structure change (rule range and pivot staleness too)
    await user.click(redoButton());
    await waitFor(() => {
      const sheet = server.workbooks.get('q3-sales')!.sheets[0];
      expect(sheet.rowCount).toBe(5);
      expect(sheet.cells.A3).toBe('East');
      expect(sheet.validationRules[0].range).toBe('B3:C5');
      expect(server.workbooks.get('q3-sales')!.pivots[0].stale).toBe(true);
    });
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('East');
    expect(screen.getByText('B3:C5 (number, 0 to 100)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh pivot table' })).toBeTruthy();

    // the redone state persists after refresh
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('East');
    expect(screen.getByText('B3:C5 (number, 0 to 100)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh pivot table' })).toBeTruthy();
  });

  it('undo restores the original formula and its calculated result; redo reapplies the edited formula', async () => {
    const wb = server.workbooks.get('q3-sales')!;
    wb.sheets[0].cells.C2 = '=B2*2';
    wb.sheets[0].cells.B2 = '4';
    const { user } = await openEditor();

    expect(screen.getByRole('gridcell', { name: 'C2' })).toHaveTextContent('8');
    await user.click(screen.getByRole('textbox', { name: 'C2' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=B2*2');

    // change the formula to =B2*3 through the grid input
    const c2 = screen.getByRole('textbox', { name: 'C2' });
    await user.click(c2);
    await user.clear(c2);
    await user.type(c2, '=B2*3');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').C2).toBe('=B2*3'));
    expect(screen.getByRole('gridcell', { name: 'C2' })).toHaveTextContent('12');

    // undo restores the original formula text and its result
    await user.click(undoButton());
    await waitFor(() => expect(cellsOf(server, 'q3-sales').C2).toBe('=B2*2'));
    expect(screen.getByRole('textbox', { name: 'C2' })).toHaveValue('=B2*2');
    expect(screen.getByRole('gridcell', { name: 'C2' })).toHaveTextContent('8');
    await user.click(screen.getByRole('textbox', { name: 'C2' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=B2*2');

    // redo reapplies the edited formula and result
    await user.click(redoButton());
    await waitFor(() => expect(screen.getByRole('gridcell', { name: 'C2' })).toHaveTextContent('12'));
    expect(screen.getByRole('textbox', { name: 'C2' })).toHaveValue('=B2*3');
  });

  it('undo in one workbook does not modify another workbook; reopening a workbook starts with empty history', async () => {
    const second = secondWorkbook();
    server.workbooks.set(second.id, second);
    const { user } = await openEditor();

    const d1 = screen.getByRole('textbox', { name: 'D1' });
    await user.click(d1);
    await user.type(d1, 'East');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').D1).toBe('East'));

    // open the other workbook: its Undo/Redo start disabled and its own
    // cells are untouched (the Q3 Sales history cannot leak across)
    await user.click(screen.getByRole('link', { name: 'Back to workbooks' }));
    await screen.findByRole('link', { name: 'Q3 Sales' });
    await user.click(screen.getByRole('link', { name: 'Second Book' }));
    await screen.findByRole('heading', { name: 'Second Book' });
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Keep');
    expect(screen.getByRole('textbox', { name: 'B1' })).toHaveValue('Me');
    expect(cellsOf(server, 'wb2').D1).toBeUndefined();

    // reopening Q3 Sales starts with empty history but keeps its data
    await user.click(screen.getByRole('link', { name: 'Back to workbooks' }));
    await user.click(await screen.findByRole('link', { name: 'Q3 Sales' }));
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('East');
  });
});
