import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createMockServer, cellsOf, type MockServer } from './test/mockServer';
import { setInternalClipboard } from './internalClipboard';
import type { Workbook } from './types';

// The REQ-4-2-1 evaluation seed: seeded workbook Q3 Sales, cells A1=2,
// B1=3, and formulas =A1+B1 and =C1*2. The seed does not state which cells
// hold the formulas, so this mirror places =A1+B1 in C1 (result 5) and
// =C1*2 in D1 (result 10) to exercise the direct (C1) and indirect (D1)
// dependency chain. E1 is an extra formula used only by the error-isolation
// test to show that an unrelated formula keeps computing.
function dependencySeedWorkbook(): Workbook {
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
        cells: {
          A1: '2',
          B1: '3',
          C1: '=A1+B1',
          D1: '=C1*2',
          E1: '=SUM(A1:B1)',
        },
        filterViews: [],
        validationRules: [],
      },
      {
        id: 'sheet2',
        name: 'Sheet2',
        rowCount: 20,
        columnCount: 6,
        cells: { A1: '10', B1: '=A1*2' },
        filterViews: [],
        validationRules: [],
      },
    ],
    pivots: [],
  };
}

describe('REQ-4-2-1 Recalculate Dependent Formulas After Source Data Changes', () => {
  let server: MockServer;

  beforeEach(() => {
    server = createMockServer([dependencySeedWorkbook()]);
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

  function rowHeader(row: number): HTMLElement {
    return screen.getByRole('rowheader', { name: String(row) });
  }

  async function openRowMenu(row: number) {
    fireEvent.contextMenu(rowHeader(row));
    await screen.findByRole('menu');
  }

  const pasteText = (text: string) => {
    fireEvent.paste(screen.getByRole('grid'), {
      clipboardData: {
        getData: (type: string) => (type === 'text' ? text : ''),
      },
    });
  };

  function dragSelect(from: string, to: string) {
    fireEvent.mouseDown(screen.getByRole('gridcell', { name: from }));
    fireEvent.mouseEnter(screen.getByRole('gridcell', { name: to }));
    fireEvent.mouseUp(window);
  }

  const cutEvent = () =>
    fireEvent.cut(screen.getByRole('grid'), { clipboardData: { setData: () => {} } });
  const pasteEvent = () =>
    fireEvent.paste(screen.getByRole('grid'), {
      clipboardData: { getData: (type: string) => (type === 'text' ? 'ignored' : '') },
    });

  // The seeded formulas display results computed from A1=2 and B1=3 while
  // the formula bar and the cell input keep the original expressions.
  function expectSeededResults() {
    expect(screen.getByRole('gridcell', { name: 'C1' })).toHaveTextContent('5');
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('10');
    expect(screen.getByRole('textbox', { name: 'C1' })).toHaveValue('=A1+B1');
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('=C1*2');
  }

  it('a source-value edit recalculates directly and indirectly dependent formulas in dependency order and persists after refresh', async () => {
    const { user, view } = await openEditor();
    expectSeededResults();

    // change the source value B1 from 3 to 4
    const b1 = screen.getByRole('textbox', { name: 'B1' });
    await user.click(b1);
    await user.clear(b1);
    await user.type(b1, '4');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').B1).toBe('4'));

    // direct dependent C1 (=A1+B1) and indirect dependent D1 (=C1*2) both
    // show results computed from the current source value
    expect(screen.getByRole('gridcell', { name: 'C1' })).toHaveTextContent('6');
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('12');

    // each formula bar continues to display the original formula
    await user.click(screen.getByRole('textbox', { name: 'C1' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=A1+B1');
    await user.click(screen.getByRole('textbox', { name: 'D1' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=C1*2');

    // refresh: results stay consistent with the current source value and do
    // not show the pre-change results (5/10)
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('2');
    expect(screen.getByRole('textbox', { name: 'B1' })).toHaveValue('4');
    expect(screen.getByRole('textbox', { name: 'C1' })).toHaveValue('=A1+B1');
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('=C1*2');
    expect(screen.getByRole('gridcell', { name: 'C1' })).toHaveTextContent('6');
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('12');
  });

  it('a bulk paste that overwrites source values recalculates dependent formulas; results persist after refresh', async () => {
    const { user, view } = await openEditor();

    await user.click(screen.getByRole('textbox', { name: 'A1' }));
    pasteText('5\t6\n7\t8');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').B2).toBe('8'));

    expect(screen.getByRole('gridcell', { name: 'A1' })).toHaveTextContent('5');
    expect(screen.getByRole('gridcell', { name: 'B1' })).toHaveTextContent('6');
    // C1 = A1+B1 = 11, D1 = C1*2 = 22 computed from the pasted values
    expect(screen.getByRole('gridcell', { name: 'C1' })).toHaveTextContent('11');
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('22');
    expect(screen.getByRole('textbox', { name: 'C1' })).toHaveValue('=A1+B1');
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('=C1*2');

    // refresh: pasted values, original formulas and recalculated results persist
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('5');
    expect(screen.getByRole('textbox', { name: 'B1' })).toHaveValue('6');
    expect(screen.getByRole('gridcell', { name: 'C1' })).toHaveTextContent('11');
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('22');
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('7');
    expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveTextContent('8');
  });

  it('a range move (cut) of a source cell recalculates dependents from the moved value and persists', async () => {
    const { user, view } = await openEditor();

    // move the source value B1=3 to B2 by cutting and pasting it there
    dragSelect('B1', 'B1');
    cutEvent();
    await user.click(screen.getByRole('textbox', { name: 'B2' }));
    pasteEvent();

    await waitFor(() => expect(cellsOf(server, 'q3-sales').B2).toBe('3'));
    // the source cell is cleared after the target has been displayed
    expect(screen.getByRole('textbox', { name: 'B1' })).toHaveValue('');
    expect(cellsOf(server, 'q3-sales').B1).toBeUndefined();

    // C1 = A1+B1 now computes from A1=2 and the empty B1 (0), D1 = C1*2
    expect(screen.getByRole('gridcell', { name: 'C1' })).toHaveTextContent('2');
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('4');
    expect(screen.getByRole('textbox', { name: 'C1' })).toHaveValue('=A1+B1');
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('=C1*2');

    // refresh: the move and the recalculated results persist
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'B1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('3');
    expect(screen.getByRole('gridcell', { name: 'C1' })).toHaveTextContent('2');
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('4');
  });

  it('a row insertion shifts the formulas with the data, adjusts their references and recalculates; the formula bar shows the adjusted formula', async () => {
    const { user, view } = await openEditor();

    await openRowMenu(1);
    await user.click(screen.getByRole('menuitem', { name: 'Insert 1 row above' }));

    // every cell moved down one row; the blank row 1 is empty
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('2');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('3');
    expect(screen.getByRole('textbox', { name: 'C2' })).toHaveValue('=A2+B2');
    expect(screen.getByRole('textbox', { name: 'D2' })).toHaveValue('=C2*2');

    // adjusted formulas display the correct results computed from A2=2/B2=3
    expect(screen.getByRole('gridcell', { name: 'C2' })).toHaveTextContent('5');
    expect(screen.getByRole('gridcell', { name: 'D2' })).toHaveTextContent('10');
    await user.click(screen.getByRole('textbox', { name: 'C2' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=A2+B2');
    await user.click(screen.getByRole('textbox', { name: 'D2' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=C2*2');

    await waitFor(() => expect(cellsOf(server, 'q3-sales').D2).toBe('=C2*2'));

    // refresh: the shifted cells, adjusted formulas and results persist
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('2');
    expect(screen.getByRole('textbox', { name: 'C2' })).toHaveValue('=A2+B2');
    expect(screen.getByRole('gridcell', { name: 'C2' })).toHaveTextContent('5');
    expect(screen.getByRole('gridcell', { name: 'D2' })).toHaveTextContent('10');
  });

  it('a column insertion shifts formulas right, adjusts references and recalculates; the formula bar shows the adjusted formula', async () => {
    const { user, view } = await openEditor();

    fireEvent.contextMenu(screen.getByRole('columnheader', { name: 'A' }));
    await screen.findByRole('menu');
    await user.click(screen.getByRole('menuitem', { name: 'Insert 1 column left' }));

    // every cell moved one column right; the blank column A is empty
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'B1' })).toHaveValue('2');
    expect(screen.getByRole('textbox', { name: 'C1' })).toHaveValue('3');
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('=B1+C1');
    expect(screen.getByRole('textbox', { name: 'E1' })).toHaveValue('=D1*2');

    // adjusted formulas display the correct results computed from B1=2/C1=3
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('5');
    expect(screen.getByRole('gridcell', { name: 'E1' })).toHaveTextContent('10');
    await user.click(screen.getByRole('textbox', { name: 'D1' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=B1+C1');

    await waitFor(() => expect(cellsOf(server, 'q3-sales').E1).toBe('=D1*2'));

    // refresh: the shifted cells, adjusted formulas and results persist
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'B1' })).toHaveValue('2');
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('=B1+C1');
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('5');
    expect(screen.getByRole('gridcell', { name: 'E1' })).toHaveTextContent('10');
  });

  it('formulas in another worksheet that do not reference these source cells remain unchanged', async () => {
    const { user, view } = await openEditor();

    // Sheet2 has its own A1=10 and B1==A1*2 (same-sheet reference)
    await user.click(screen.getByRole('tab', { name: 'Sheet2' }));
    expect(screen.getByRole('gridcell', { name: 'B1' })).toHaveTextContent('20');
    expect(screen.getByRole('textbox', { name: 'B1' })).toHaveValue('=A1*2');
    await user.click(screen.getByRole('tab', { name: 'Sheet1' }));

    // change the source value A1 in Sheet1 from 2 to 7
    const a1 = screen.getByRole('textbox', { name: 'A1' });
    await user.click(a1);
    await user.clear(a1);
    await user.type(a1, '7');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').A1).toBe('7'));

    // Sheet1 dependents recalculate
    expect(screen.getByRole('gridcell', { name: 'C1' })).toHaveTextContent('10');
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('20');

    // Sheet2's formula still evaluates against Sheet2's own source value
    await user.click(screen.getByRole('tab', { name: 'Sheet2' }));
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('10');
    expect(screen.getByRole('gridcell', { name: 'B1' })).toHaveTextContent('20');
    expect(screen.getByRole('textbox', { name: 'B1' })).toHaveValue('=A1*2');

    // refresh: both sheets keep their own persisted values and formulas
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    await user.click(screen.getByRole('tab', { name: 'Sheet1' }));
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('7');
    expect(screen.getByRole('gridcell', { name: 'C1' })).toHaveTextContent('10');
    await user.click(screen.getByRole('tab', { name: 'Sheet2' }));
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('10');
    expect(screen.getByRole('gridcell', { name: 'B1' })).toHaveTextContent('20');
    expect(screen.getByRole('textbox', { name: 'B1' })).toHaveValue('=A1*2');
  });

  it('an erroneous formula does not affect unrelated cells: the grid shows the error while other formulas keep computing', async () => {
    const { user } = await openEditor();

    // make A1 non-numeric so =A1+B1 and its dependent =C1*2 can no longer
    // compute a numeric result
    const a1 = screen.getByRole('textbox', { name: 'A1' });
    await user.click(a1);
    await user.clear(a1);
    await user.type(a1, 'abc');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').A1).toBe('abc'));

    // the affected formulas display the REQ-4-2-2 error token: arithmetic
    // on non-numeric text is a malformed expression, and the dependent
    // formula propagates the same token
    expect(screen.getByRole('gridcell', { name: 'C1' })).toHaveTextContent('#ERROR!');
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('#ERROR!');

    // an unrelated formula keeps computing from the remaining numeric cells
    // (SUM ignores non-numeric text: B1=3)
    expect(screen.getByRole('gridcell', { name: 'E1' })).toHaveTextContent('3');

    // the formula bar still shows the original formula for the error cell
    await user.click(screen.getByRole('textbox', { name: 'C1' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=A1+B1');
  });
});
