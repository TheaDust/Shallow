import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createMockServer, cellsOf, type MockServer } from './test/mockServer';
import { readExternalClipboardText } from './clipboard';
import type { Workbook } from './types';

vi.mock('./clipboard', () => ({
  readExternalClipboardText: vi.fn(),
}));

// The REQ-3-1-2 evaluation seed: seeded workbook Q3 Sales, range A1:B2
// containing Item/Qty and Pen/4, target range D1:E2.
function pasteSeedWorkbook(extra?: Partial<Workbook['sheets'][number]>): Workbook {
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

describe('REQ-3-1-2 Paste Two-Dimensional Table Data', () => {
  let server: MockServer;

  beforeEach(() => {
    server = createMockServer([pasteSeedWorkbook()]);
    vi.stubGlobal('fetch', server.fetch);
    vi.mocked(readExternalClipboardText).mockReset();
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

  const pasteText = (text: string) => {
    fireEvent.paste(screen.getByRole('grid'), {
      clipboardData: {
        getData: (type: string) => (type === 'text' ? text : ''),
      },
    });
  };

  it('Ctrl+V pastes the external clipboard rectangle into the starting cell, keeps the seeded A1:B2 range and persists after refresh', async () => {
    const { user, view } = await openEditor();

    const d1 = screen.getByRole('textbox', { name: 'D1' });
    await user.click(d1);
    pasteText('East\t1200\nNorth\t800');

    await waitFor(() => expect(cellsOf(server, 'q3-sales').E2).toBe('800'));

    // the full rectangle is visible in the grid
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('East');
    expect(screen.getByRole('gridcell', { name: 'E1' })).toHaveTextContent('1200');
    expect(screen.getByRole('gridcell', { name: 'D2' })).toHaveTextContent('North');
    expect(screen.getByRole('gridcell', { name: 'E2' })).toHaveTextContent('800');

    // the seeded A1:B2 range is unchanged
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Item/Qty');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('Pen/4');
    expect(screen.getByRole('textbox', { name: 'B1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('');

    // grid input and formula bar are consistent for the starting cell
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('East');

    // refresh: the successful result remains persisted
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'E1' })).toHaveValue('1200');
    expect(screen.getByRole('textbox', { name: 'D2' })).toHaveValue('North');
    expect(screen.getByRole('textbox', { name: 'E2' })).toHaveValue('800');
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Item/Qty');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('Pen/4');
    expect(screen.getByRole('textbox', { name: 'B1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('');
  });

  it('paste replaces formulas inside the target and dependent formulas display recalculated results', async () => {
    const wb = server.workbooks.get('q3-sales');
    expect(wb).toBeTruthy();
    wb!.sheets[0].cells.D1 = '=5*2';
    wb!.sheets[0].cells.F1 = '=SUM(D1:E2)';
    const { user, view } = await openEditor();

    // before the paste: the target formula displays its result and the
    // dependent SUM shows the current total
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('10');
    expect(screen.getByRole('gridcell', { name: 'F1' })).toHaveTextContent('10');

    await user.click(screen.getByRole('textbox', { name: 'D1' }));
    pasteText('East\t1200\nNorth\t800');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').E2).toBe('800'));

    // the formula inside the target is replaced by the pasted content
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('East');
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('East');

    // the dependent formula recalculates (1200 + 800; text cells are skipped)
    expect(screen.getByRole('gridcell', { name: 'F1' })).toHaveTextContent('2000');

    // results, formulas and original formulas persist after refresh
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'F1' })).toHaveValue('=SUM(D1:E2)');
    expect(screen.getByRole('gridcell', { name: 'F1' })).toHaveTextContent('2000');
  });

  it('a 0-to-100 numeric validation rule rejects the whole paste with the exact message and no partial record', async () => {
    const wb = server.workbooks.get('q3-sales');
    expect(wb).toBeTruthy();
    wb!.sheets[0].validationRules = [
      { id: 'vr1', range: 'D1:E2', type: 'number', min: 0, max: 100 },
    ];
    const { user, view } = await openEditor();

    await user.click(screen.getByRole('textbox', { name: 'D1' }));
    pasteText('East\t1200\nNorth\t800');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please enter a number from 0 to 100'
    );

    // every target cell retains its original value and nothing was saved
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'E1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'D2' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'E2' })).toHaveValue('');
    expect(cellsOf(server, 'q3-sales').D1).toBeUndefined();
    expect(cellsOf(server, 'q3-sales').E1).toBeUndefined();
    expect(cellsOf(server, 'q3-sales').D2).toBeUndefined();
    expect(cellsOf(server, 'q3-sales').E2).toBeUndefined();

    // refresh: the original seeded state remains unchanged
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'E1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'D2' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'E2' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Item/Qty');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('Pen/4');
    expect(screen.getByRole('textbox', { name: 'B1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('');
  });

  it('a paste that satisfies the validation rule commits every cell of the rectangle', async () => {
    const wb = server.workbooks.get('q3-sales');
    expect(wb).toBeTruthy();
    wb!.sheets[0].validationRules = [
      { id: 'vr1', range: 'D1:E2', type: 'number', min: 0, max: 100 },
    ];
    const { user } = await openEditor();

    await user.click(screen.getByRole('textbox', { name: 'D1' }));
    pasteText('50\t60\n70\t80');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').E2).toBe('80'));
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('50');
    expect(screen.getByRole('gridcell', { name: 'E1' })).toHaveTextContent('60');
    expect(screen.getByRole('gridcell', { name: 'D2' })).toHaveTextContent('70');
    expect(screen.getByRole('gridcell', { name: 'E2' })).toHaveTextContent('80');
  });

  it('the grid context menu provides a Paste menuitem that reads the external clipboard and pastes into the clicked cell', async () => {
    vi.mocked(readExternalClipboardText).mockResolvedValue('East\t1200\nNorth\t800');
    const { user, view } = await openEditor();

    // right-click selects the cell and opens the context menu
    const d1 = screen.getByRole('gridcell', { name: 'D1' });
    fireEvent.contextMenu(d1);
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    const pasteItem = screen.getByRole('menuitem', { name: 'Paste' });
    await user.click(pasteItem);

    await waitFor(() => expect(cellsOf(server, 'q3-sales').E2).toBe('800'));
    expect(screen.queryByRole('menuitem', { name: 'Paste' })).toBeNull();
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('East');
    expect(screen.getByRole('gridcell', { name: 'E1' })).toHaveTextContent('1200');
    expect(screen.getByRole('gridcell', { name: 'D2' })).toHaveTextContent('North');
    expect(screen.getByRole('gridcell', { name: 'E2' })).toHaveTextContent('800');

    // refresh: the pasted rectangle persists
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'E1' })).toHaveValue('1200');
    expect(screen.getByRole('textbox', { name: 'D2' })).toHaveValue('North');
    expect(screen.getByRole('textbox', { name: 'E2' })).toHaveValue('800');
  });

  it('a clipboard read failure from the Paste menu shows an error and leaves the cells unchanged', async () => {
    vi.mocked(readExternalClipboardText).mockRejectedValue(new Error('permission denied'));
    const { user } = await openEditor();

    fireEvent.contextMenu(screen.getByRole('gridcell', { name: 'D1' }));
    await user.click(screen.getByRole('menuitem', { name: 'Paste' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to read the clipboard. Please press Ctrl+V to paste.'
    );
    expect(cellsOf(server, 'q3-sales').D1).toBeUndefined();
    expect(cellsOf(server, 'q3-sales').E1).toBeUndefined();
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'E1' })).toHaveValue('');
  });

  it('pasting text with empty fields clears the target cells instead of silently dropping values', async () => {
    const wb = server.workbooks.get('q3-sales');
    expect(wb).toBeTruthy();
    wb!.sheets[0].cells.D1 = 'old1';
    wb!.sheets[0].cells.E1 = 'old2';
    wb!.sheets[0].cells.D2 = 'old3';
    wb!.sheets[0].cells.E2 = 'old4';
    const { user } = await openEditor();

    await user.click(screen.getByRole('textbox', { name: 'D1' }));
    pasteText('a\t\tc\n\t\t');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').E2).toBeUndefined());

    // D1=a, F1=c; E1, D2, E2 cleared; F2 outside the rectangle untouched
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('a');
    expect(screen.getByRole('textbox', { name: 'E1' })).toHaveValue('');
    expect(screen.getByRole('gridcell', { name: 'F1' })).toHaveTextContent('c');
    expect(screen.getByRole('textbox', { name: 'D2' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'E2' })).toHaveValue('');
    expect(cellsOf(server, 'q3-sales').E1).toBeUndefined();
    expect(cellsOf(server, 'q3-sales').D2).toBeUndefined();
    expect(cellsOf(server, 'q3-sales').E2).toBeUndefined();
    expect(cellsOf(server, 'q3-sales').D1).toBe('a');
    expect(cellsOf(server, 'q3-sales').F1).toBe('c');
  });
});
