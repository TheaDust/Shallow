import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createMockServer, cellsOf, type MockServer } from './test/mockServer';
import type { Workbook } from './types';

// The REQ-4-2-2 evaluation seed: seeded workbook Q3 Sales, cells A1=2,
// B1=3 and formulas =A1+B1 and =C1*2. Following the REQ-4-1-1 / REQ-4-2-1
// mirror, the formulas live in C1 (=A1+B1) and D1 (=C1*2). E1 is an extra
// formula used only by the error-isolation tests to show that an unrelated
// formula keeps computing while another cell errors.
function errorSeedWorkbook(): Workbook {
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
    ],
    pivots: [],
  };
}

describe('REQ-4-2-2 Display and Fix Formula Errors', () => {
  let server: MockServer;

  beforeEach(() => {
    server = createMockServer([errorSeedWorkbook()]);
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

  // Selects the cell and submits a value through the labelled formula bar
  // (the REQ-3-1-1 submission path), waiting for the persisted cell value.
  async function setCell(
    user: ReturnType<typeof userEvent.setup>,
    coord: string,
    value: string
  ) {
    await user.click(screen.getByRole('textbox', { name: coord }));
    const fb = screen.getByRole('textbox', { name: 'Formula bar' });
    await user.clear(fb);
    await user.type(fb, value);
    await waitFor(() => expect(cellsOf(server, 'q3-sales')[coord]).toBe(value));
  }

  it('the seeded workbook keeps its names and values while the formula cells show results and original formulas', async () => {
    const { user, view } = await openEditor();

    // seeded source values and formulas
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('2');
    expect(screen.getByRole('textbox', { name: 'B1' })).toHaveValue('3');
    expect(screen.getByRole('textbox', { name: 'C1' })).toHaveValue('=A1+B1');
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('=C1*2');
    expect(screen.getByRole('gridcell', { name: 'C1' })).toHaveTextContent('5');
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('10');

    // the formula bar shows the original submitted formula for a formula cell
    await user.click(screen.getByRole('textbox', { name: 'C1' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=A1+B1');

    // refresh: the same seeded names and values remain persisted
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

  it('division by zero displays #DIV/0!; the formula bar keeps the submitted formula and both persist after refresh', async () => {
    const { user, view } = await openEditor();

    await setCell(user, 'A2', '=1/0');
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('#DIV/0!');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('=1/0');

    // selecting the error cell shows the original formula in the formula bar
    await user.click(screen.getByRole('textbox', { name: 'B2' }));
    await user.click(screen.getByRole('textbox', { name: 'A2' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=1/0');

    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('#DIV/0!');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('=1/0');
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=1/0');
  });

  it('an unsupported function displays #NAME? and persists the original formula', async () => {
    const { user, view } = await openEditor();

    await setCell(user, 'A2', '=FOO(1)');
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('#NAME?');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('=FOO(1)');
    await user.click(screen.getByRole('textbox', { name: 'A2' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=FOO(1)');

    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('#NAME?');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('=FOO(1)');
  });

  it('a malformed expression displays #ERROR! and persists the original formula', async () => {
    const { user, view } = await openEditor();

    await setCell(user, 'A2', '=1+');
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('#ERROR!');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('=1+');
    await user.click(screen.getByRole('textbox', { name: 'A2' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=1+');

    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('#ERROR!');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('=1+');
  });

  it('an invalid reference displays #REF! and persists the original formula', async () => {
    const { user, view } = await openEditor();

    await setCell(user, 'A2', '=#REF!+1');
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('#REF!');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('=#REF!+1');
    await user.click(screen.getByRole('textbox', { name: 'A2' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=#REF!+1');

    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('#REF!');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('=#REF!+1');
  });

  it('a direct circular reference displays #REF! and keeps the original formula', async () => {
    const { user, view } = await openEditor();

    await setCell(user, 'A2', '=A2*2');
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('#REF!');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('=A2*2');
    await user.click(screen.getByRole('textbox', { name: 'A2' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=A2*2');

    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('#REF!');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('=A2*2');
  });

  it('an indirect circular reference displays #REF! in both cells', async () => {
    const { user } = await openEditor();

    await setCell(user, 'A2', '=B2+1');
    await setCell(user, 'B2', '=A2+1');
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('#REF!');
    expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveTextContent('#REF!');
    await user.click(screen.getByRole('textbox', { name: 'A2' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=B2+1');
    await user.click(screen.getByRole('textbox', { name: 'B2' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=A2+1');
  });

  it('an error cell does not block viewing, editing or recalculating other cells; fixing the formula updates dependents and the error no longer appears after refresh', async () => {
    const { user, view } = await openEditor();

    // make the source A1 non-numeric: C1 and its dependent D1 error while
    // the unrelated formula E1 keeps computing from the remaining numeric cell
    await setCell(user, 'A1', 'abc');
    expect(screen.getByRole('gridcell', { name: 'C1' })).toHaveTextContent('#ERROR!');
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('#ERROR!');
    expect(screen.getByRole('gridcell', { name: 'E1' })).toHaveTextContent('3');
    // the error cell remains selectable and editable: its original formula
    // is still shown in the formula bar
    await user.click(screen.getByRole('textbox', { name: 'C1' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=A1+B1');

    // change the error cell to a valid formula: the grid shows the new
    // result, the formula bar shows the new formula, and the dependent D1
    // (=C1*2) updates to the new value
    await setCell(user, 'C1', '=1+4');
    expect(screen.getByRole('gridcell', { name: 'C1' })).toHaveTextContent('5');
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('10');
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('abc');
    await user.click(screen.getByRole('textbox', { name: 'C1' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=1+4');

    // refresh: the fixed formula, the recalculated results and the source
    // value persist and the error does not reappear
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('abc');
    expect(screen.getByRole('textbox', { name: 'C1' })).toHaveValue('=1+4');
    expect(screen.getByRole('gridcell', { name: 'C1' })).toHaveTextContent('5');
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('10');
  });
});
