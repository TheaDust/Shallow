import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createMockServer, cellsOf, type MockServer } from './test/mockServer';
import { setInternalClipboard } from './internalClipboard';
import type { Workbook } from './types';

// The REQ-4-1-2 evaluation seed: seeded workbook Q3 Sales, cells A1=2,
// B1=3 and formulas =A1+B1 and =C1*2. The seed does not state which cells
// hold the formulas, so this mirror places =A1+B1 in C1 (result 5) and
// =C1*2 in D1 (result 10), matching the REQ-4-1-1 mirror.
function formulaCopySeedWorkbook(): Workbook {
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
        cells: { A1: '2', B1: '3', C1: '=A1+B1', D1: '=C1*2' },
        filterViews: [],
        validationRules: [],
      },
    ],
    pivots: [],
  };
}

describe('REQ-4-1-2 Copy Formulas and Adjust Relative References', () => {
  let server: MockServer;

  beforeEach(() => {
    server = createMockServer([formulaCopySeedWorkbook()]);
    vi.stubGlobal('fetch', server.fetch);
    setInternalClipboard(null);
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

  function dragSelect(from: string, to: string) {
    fireEvent.mouseDown(screen.getByRole('gridcell', { name: from }));
    fireEvent.mouseEnter(screen.getByRole('gridcell', { name: to }));
    fireEvent.mouseUp(window);
  }

  const copyEvent = () =>
    fireEvent.copy(screen.getByRole('grid'), { clipboardData: { setData: () => {} } });
  const pasteEvent = () =>
    fireEvent.paste(screen.getByRole('grid'), {
      clipboardData: { getData: (type: string) => (type === 'text' ? 'ignored' : '') },
    });

  async function typeInFormulaBar(user: ReturnType<typeof userEvent.setup>, coord: string, text: string) {
    await user.click(screen.getByRole('textbox', { name: coord }));
    const fb = screen.getByRole('textbox', { name: 'Formula bar' });
    await user.click(fb);
    await user.type(fb, text);
    await waitFor(() => expect(cellsOf(server, 'q3-sales')[coord]).toBe(text));
  }

  it('copying a formula cell adjusts relative references by the target offset; the formula bar shows the adjusted formula, the grid shows the new result, the source stays unchanged and everything persists after refresh', async () => {
    const { user, view } = await openEditor();

    // seeded source values and formulas
    expect(screen.getByRole('gridcell', { name: 'C1' })).toHaveTextContent('5');
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('10');

    dragSelect('C1', 'C1');
    copyEvent();
    await user.click(screen.getByRole('textbox', { name: 'E1' }));
    pasteEvent();

    // target stores the adjusted formula, the grid computes from the new
    // references (C1=5, D1=10 -> 15) and the formula bar displays it
    await waitFor(() => expect(cellsOf(server, 'q3-sales').E1).toBe('=C1+D1'));
    expect(screen.getByRole('gridcell', { name: 'E1' })).toHaveTextContent('15');
    expect(screen.getByRole('textbox', { name: 'E1' })).toHaveValue('=C1+D1');
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=C1+D1');

    // the source formula and result remain unchanged
    expect(screen.getByRole('textbox', { name: 'C1' })).toHaveValue('=A1+B1');
    expect(screen.getByRole('gridcell', { name: 'C1' })).toHaveTextContent('5');
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('=C1*2');
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('10');

    // refresh: adjusted formula, recalculated result and untouched source persist
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'E1' })).toHaveValue('=C1+D1');
    expect(screen.getByRole('gridcell', { name: 'E1' })).toHaveTextContent('15');
    expect(screen.getByRole('textbox', { name: 'C1' })).toHaveValue('=A1+B1');
    expect(screen.getByRole('gridcell', { name: 'C1' })).toHaveTextContent('5');
    expect(cellsOf(server, 'q3-sales').A1).toBe('2');
    expect(cellsOf(server, 'q3-sales').B1).toBe('3');
  });

  it('copying a range of formulas preserves the two-dimensional layout and adjusts every formula', async () => {
    const { user, view } = await openEditor();

    dragSelect('C1', 'D1');
    copyEvent();
    await user.click(screen.getByRole('textbox', { name: 'E1' }));
    pasteEvent();

    await waitFor(() => expect(cellsOf(server, 'q3-sales').F1).toBe('=E1*2'));
    expect(screen.getByRole('textbox', { name: 'E1' })).toHaveValue('=C1+D1');
    expect(screen.getByRole('gridcell', { name: 'E1' })).toHaveTextContent('15');
    expect(screen.getByRole('textbox', { name: 'F1' })).toHaveValue('=E1*2');
    expect(screen.getByRole('gridcell', { name: 'F1' })).toHaveTextContent('30');

    // the copied source range is untouched
    expect(screen.getByRole('textbox', { name: 'C1' })).toHaveValue('=A1+B1');
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('=C1*2');

    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'E1' })).toHaveValue('=C1+D1');
    expect(screen.getByRole('gridcell', { name: 'E1' })).toHaveTextContent('15');
    expect(screen.getByRole('textbox', { name: 'F1' })).toHaveValue('=E1*2');
    expect(screen.getByRole('gridcell', { name: 'F1' })).toHaveTextContent('30');
  });

  it('absolute references remain unchanged when the formula is copied and still compute', async () => {
    const { user, view } = await openEditor();

    await typeInFormulaBar(user, 'A2', '=$A$1+$B$1');
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('5');

    dragSelect('A2', 'A2');
    copyEvent();
    await user.click(screen.getByRole('textbox', { name: 'E2' }));
    pasteEvent();

    await waitFor(() => expect(cellsOf(server, 'q3-sales').E2).toBe('=$A$1+$B$1'));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=$A$1+$B$1');
    // the absolute reference still resolves to A1=2 + B1=3
    expect(screen.getByRole('gridcell', { name: 'E2' })).toHaveTextContent('5');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('=$A$1+$B$1');

    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'E2' })).toHaveValue('=$A$1+$B$1');
    expect(screen.getByRole('gridcell', { name: 'E2' })).toHaveTextContent('5');
  });

  it('an offset moving relative references above/left of the worksheet bounds shows =#REF! in the formula bar and #REF! in the grid', async () => {
    const { user, view } = await openEditor();

    // copy C1 (=A1+B1) to A1: both references move off the left edge
    dragSelect('C1', 'C1');
    copyEvent();
    await user.click(screen.getByRole('textbox', { name: 'A1' }));
    pasteEvent();

    await waitFor(() => expect(cellsOf(server, 'q3-sales').A1).toBe('=#REF!+#REF!'));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=#REF!+#REF!');
    expect(screen.getByRole('gridcell', { name: 'A1' })).toHaveTextContent('#REF!');

    // copy D1 (=C1*2) to A1: the C1 reference moves off the left edge
    dragSelect('D1', 'D1');
    copyEvent();
    await user.click(screen.getByRole('textbox', { name: 'A1' }));
    pasteEvent();

    await waitFor(() => expect(cellsOf(server, 'q3-sales').A1).toBe('=#REF!*2'));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=#REF!*2');
    expect(screen.getByRole('gridcell', { name: 'A1' })).toHaveTextContent('#REF!');

    // a single-reference formula copied off the edge displays exactly =#REF!
    await typeInFormulaBar(user, 'D2', '=C1');
    dragSelect('D2', 'D2');
    copyEvent();
    await user.click(screen.getByRole('textbox', { name: 'A2' }));
    pasteEvent();

    await waitFor(() => expect(cellsOf(server, 'q3-sales').A2).toBe('=#REF!'));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=#REF!');
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('#REF!');

    // refresh: error value and original adjusted formula persist
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('=#REF!*2');
    expect(screen.getByRole('gridcell', { name: 'A1' })).toHaveTextContent('#REF!');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('=#REF!');
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('#REF!');
  });

  it('an offset moving a relative reference past the right/bottom edge of the worksheet shows #REF!', async () => {
    const { user, view } = await openEditor();

    // E2 references F1; copying E2 to F2 shifts F1 to G1 (past column F)
    await typeInFormulaBar(user, 'E2', '=F1*2');
    dragSelect('E2', 'E2');
    copyEvent();
    await user.click(screen.getByRole('textbox', { name: 'F2' }));
    pasteEvent();

    await waitFor(() => expect(cellsOf(server, 'q3-sales').F2).toBe('=#REF!*2'));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=#REF!*2');
    expect(screen.getByRole('gridcell', { name: 'F2' })).toHaveTextContent('#REF!');

    // E3 references A20; copying E3 to E4 shifts A20 to A21 (past row 20)
    await typeInFormulaBar(user, 'E3', '=A20*2');
    dragSelect('E3', 'E3');
    copyEvent();
    await user.click(screen.getByRole('textbox', { name: 'E4' }));
    pasteEvent();

    await waitFor(() => expect(cellsOf(server, 'q3-sales').E4).toBe('=#REF!*2'));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=#REF!*2');
    expect(screen.getByRole('gridcell', { name: 'E4' })).toHaveTextContent('#REF!');

    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'F2' })).toHaveValue('=#REF!*2');
    expect(screen.getByRole('gridcell', { name: 'F2' })).toHaveTextContent('#REF!');
    expect(screen.getByRole('textbox', { name: 'E4' })).toHaveValue('=#REF!*2');
    expect(screen.getByRole('gridcell', { name: 'E4' })).toHaveTextContent('#REF!');
  });
});
