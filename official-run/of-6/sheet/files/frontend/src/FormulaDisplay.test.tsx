import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createMockServer, cellsOf, type MockServer } from './test/mockServer';
import type { Workbook } from './types';

// The REQ-4-1-1 evaluation seed: seeded workbook Q3 Sales, cells A1=2,
// B1=3 and formulas =A1+B1 and =C1*2. The seed does not state which cells
// hold the formulas, so this mirror places =A1+B1 in C1 (result 5) and
// =C1*2 in D1 (result 10) to also exercise the dependency chain.
function formulaSeedWorkbook(): Workbook {
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

describe('REQ-4-1-1 Calculate Basic Expressions and Aggregate Functions', () => {
  let server: MockServer;

  beforeEach(() => {
    server = createMockServer([formulaSeedWorkbook()]);
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

  it('grid shows the seeded formulas calculated from current source data; formula bar shows the original expression; both persist after refresh', async () => {
    const { user, view } = await openEditor();

    // seeded source values
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('2');
    expect(screen.getByRole('textbox', { name: 'B1' })).toHaveValue('3');

    // grid displays results computed from the current source data
    expect(screen.getByRole('gridcell', { name: 'C1' })).toHaveTextContent('5');
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('10');

    // formula cells keep the original submitted formula in the grid input
    // and the formula bar shows it when the cell is selected
    expect(screen.getByRole('textbox', { name: 'C1' })).toHaveValue('=A1+B1');
    await user.click(screen.getByRole('textbox', { name: 'C1' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=A1+B1');
    await user.click(screen.getByRole('textbox', { name: 'D1' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=C1*2');

    // refresh: values, original formulas and results remain persisted
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('2');
    expect(screen.getByRole('textbox', { name: 'B1' })).toHaveValue('3');
    expect(screen.getByRole('textbox', { name: 'C1' })).toHaveValue('=A1+B1');
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('=C1*2');
    expect(screen.getByRole('gridcell', { name: 'C1' })).toHaveTextContent('5');
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('10');
  });

  it('aggregate functions entered through the formula bar calculate and persist; a reference to an empty cell acts as zero', async () => {
    const { user, view } = await openEditor();

    await user.click(screen.getByRole('textbox', { name: 'A2' }));
    let fb = screen.getByRole('textbox', { name: 'Formula bar' });
    await user.click(fb);
    await user.type(fb, '=SUM(A1:B1)');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').A2).toBe('=SUM(A1:B1)'));
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('5');

    await user.click(screen.getByRole('textbox', { name: 'B2' }));
    fb = screen.getByRole('textbox', { name: 'Formula bar' });
    await user.click(fb);
    await user.type(fb, '=average(2,4)');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').B2).toBe('=average(2,4)'));
    expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveTextContent('3');

    await user.click(screen.getByRole('textbox', { name: 'C2' }));
    fb = screen.getByRole('textbox', { name: 'Formula bar' });
    await user.click(fb);
    await user.type(fb, '=COUNT(A1:C1)');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').C2).toBe('=COUNT(A1:C1)'));
    // A1=2, B1=3 and C1=5 are all numeric cells
    expect(screen.getByRole('gridcell', { name: 'C2' })).toHaveTextContent('3');

    await user.click(screen.getByRole('textbox', { name: 'D2' }));
    fb = screen.getByRole('textbox', { name: 'Formula bar' });
    await user.click(fb);
    await user.type(fb, '=MIN(A1:C1)');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').D2).toBe('=MIN(A1:C1)'));
    expect(screen.getByRole('gridcell', { name: 'D2' })).toHaveTextContent('2');

    await user.click(screen.getByRole('textbox', { name: 'E2' }));
    fb = screen.getByRole('textbox', { name: 'Formula bar' });
    await user.click(fb);
    await user.type(fb, '=MAX(A1:C1)');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').E2).toBe('=MAX(A1:C1)'));
    expect(screen.getByRole('gridcell', { name: 'E2' })).toHaveTextContent('5');

    // an aggregate over a range that contains no numeric cells counts zero
    // numeric cells while a plain arithmetic reference to an empty cell is 0
    await user.click(screen.getByRole('textbox', { name: 'A3' }));
    fb = screen.getByRole('textbox', { name: 'Formula bar' });
    await user.click(fb);
    await user.type(fb, '=SUM(B3:B4)');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').A3).toBe('=SUM(B3:B4)'));
    expect(screen.getByRole('gridcell', { name: 'A3' })).toHaveTextContent('0');

    await user.click(screen.getByRole('textbox', { name: 'B3' }));
    fb = screen.getByRole('textbox', { name: 'Formula bar' });
    await user.click(fb);
    await user.type(fb, '=C3*2');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').B3).toBe('=C3*2'));
    expect(screen.getByRole('gridcell', { name: 'B3' })).toHaveTextContent('0');

    // the formula bar always shows the original expression
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=C3*2');

    // refresh: aggregate formulas, original text and results persist
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('=SUM(A1:B1)');
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('5');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('=average(2,4)');
    expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveTextContent('3');
    expect(screen.getByRole('textbox', { name: 'C2' })).toHaveValue('=COUNT(A1:C1)');
    expect(screen.getByRole('gridcell', { name: 'C2' })).toHaveTextContent('3');
    expect(screen.getByRole('textbox', { name: 'D2' })).toHaveValue('=MIN(A1:C1)');
    expect(screen.getByRole('gridcell', { name: 'D2' })).toHaveTextContent('2');
    expect(screen.getByRole('textbox', { name: 'E2' })).toHaveValue('=MAX(A1:C1)');
    expect(screen.getByRole('gridcell', { name: 'E2' })).toHaveTextContent('5');
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('=SUM(B3:B4)');
    expect(screen.getByRole('gridcell', { name: 'A3' })).toHaveTextContent('0');
    expect(screen.getByRole('textbox', { name: 'B3' })).toHaveValue('=C3*2');
    expect(screen.getByRole('gridcell', { name: 'B3' })).toHaveTextContent('0');
  });

  it('editing a source value updates direct and indirect dependents and persists the recalculated results', async () => {
    const { user, view } = await openEditor();

    const b1 = screen.getByRole('textbox', { name: 'B1' });
    await user.click(b1);
    await user.clear(b1);
    await user.type(b1, '4');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').B1).toBe('4'));

    expect(screen.getByRole('gridcell', { name: 'C1' })).toHaveTextContent('6');
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('12');
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('4');

    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'B1' })).toHaveValue('4');
    expect(screen.getByRole('textbox', { name: 'C1' })).toHaveValue('=A1+B1');
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('=C1*2');
    expect(screen.getByRole('gridcell', { name: 'C1' })).toHaveTextContent('6');
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('12');
  });
});
