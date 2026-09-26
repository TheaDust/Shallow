import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createMockServer, cellsOf, type MockServer } from './test/mockServer';
import type { Workbook } from './types';

// The REQ-3-1-1 evaluation seed: seeded workbook Q3 Sales, range A1:B2
// containing Item/Qty and Pen/4, target range D1:E2.
function cellEditSeedWorkbook(): Workbook {
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
      },
    ],
    pivots: [],
  };
}

describe('REQ-3-1-1 Edit a Cell Through the Grid or Formula Bar', () => {
  let server: MockServer;

  beforeEach(() => {
    server = createMockServer([cellEditSeedWorkbook()]);
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

  it('entering East/1200/North/800 into D1:E2 through grid controls commits, keeps the seeded A1:B2 range and persists after refresh', async () => {
    const { user, view } = await openEditor();

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

    // target range committed and visible in the grid
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('East');
    expect(screen.getByRole('gridcell', { name: 'E1' })).toHaveTextContent('1200');
    expect(screen.getByRole('gridcell', { name: 'D2' })).toHaveTextContent('North');
    expect(screen.getByRole('gridcell', { name: 'E2' })).toHaveTextContent('800');

    // the seeded A1:B2 range is unchanged
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Item/Qty');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('Pen/4');
    expect(screen.getByRole('textbox', { name: 'B1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('');

    // grid input, gridcell and formula bar show consistent content for the selected cell
    expect(screen.getByRole('textbox', { name: 'E2' })).toHaveValue('800');
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('800');

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

  it('Escape cancels uncommitted grid entry so the original seeded state remains after refresh', async () => {
    const { user, view } = await openEditor();

    const d1 = screen.getByRole('textbox', { name: 'D1' });
    await user.click(d1);
    await user.type(d1, 'East');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').D1).toBeUndefined());
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('');

    const e1 = screen.getByRole('textbox', { name: 'E1' });
    await user.click(e1);
    await user.type(e1, '1200');
    await user.keyboard('{Escape}');
    const d2 = screen.getByRole('textbox', { name: 'D2' });
    await user.click(d2);
    await user.type(d2, 'North');
    await user.keyboard('{Escape}');
    const e2 = screen.getByRole('textbox', { name: 'E2' });
    await user.click(e2);
    await user.type(e2, '800');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').E2).toBeUndefined());

    expect(screen.getByRole('textbox', { name: 'E1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'D2' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'E2' })).toHaveValue('');

    // refresh: the cancelled entries stay absent and the seeded range is intact
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

  it('Escape cancels an uncommitted formula bar change for the selected cell', async () => {
    const { user } = await openEditor();

    await user.click(screen.getByRole('textbox', { name: 'D1' }));
    const fb = screen.getByRole('textbox', { name: 'Formula bar' });
    await user.click(fb);
    await user.type(fb, 'East');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(cellsOf(server, 'q3-sales').D1).toBeUndefined());
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('');

    // a committed formula bar entry is not cancelled by a later Escape
    await user.type(fb, 'North');
    await user.click(screen.getByRole('textbox', { name: 'D2' }));
    await waitFor(() => expect(cellsOf(server, 'q3-sales').D1).toBe('North'));
  });

  it('entering a value through the Formula bar updates the selected cell, the grid and persists', async () => {
    const { user, view } = await openEditor();

    await user.click(screen.getByRole('textbox', { name: 'D1' }));
    const fb = screen.getByRole('textbox', { name: 'Formula bar' });
    await user.click(fb);
    await user.clear(fb);
    await user.type(fb, 'East');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').D1).toBe('East'));

    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('East');
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('East');
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('East');

    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('East');
  });

  it('formula cells show the calculated result in the grid and the original formula in the formula bar; dependent formulas update after a source commit and persist', async () => {
    const wb = server.workbooks.get('q3-sales');
    expect(wb).toBeTruthy();
    wb!.sheets[0].cells.B2 = '4';
    wb!.sheets[0].cells.C2 = '=B2*2';
    wb!.sheets[0].cells.D2 = '=C2+1';
    wb!.sheets[0].cells.E2 = '=D2*10';
    const { user, view } = await openEditor();

    // grid displays calculated results; inputs keep the original formulas
    expect(screen.getByRole('gridcell', { name: 'C2' })).toHaveTextContent('8');
    expect(screen.getByRole('gridcell', { name: 'D2' })).toHaveTextContent('9');
    expect(screen.getByRole('gridcell', { name: 'E2' })).toHaveTextContent('90');
    expect(screen.getByRole('textbox', { name: 'C2' })).toHaveValue('=B2*2');

    // the formula bar shows the original submitted formula for formula cells
    await user.click(screen.getByRole('textbox', { name: 'D2' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=C2+1');
    await user.click(screen.getByRole('textbox', { name: 'E2' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=D2*10');

    // committing a source value updates direct and indirect dependents
    const b2 = screen.getByRole('textbox', { name: 'B2' });
    await user.click(b2);
    await user.clear(b2);
    await user.type(b2, '5');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').B2).toBe('5'));
    expect(screen.getByRole('gridcell', { name: 'C2' })).toHaveTextContent('10');
    expect(screen.getByRole('gridcell', { name: 'D2' })).toHaveTextContent('11');
    expect(screen.getByRole('gridcell', { name: 'E2' })).toHaveTextContent('110');

    // values, original formulas and results persist after refresh
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('5');
    expect(screen.getByRole('textbox', { name: 'C2' })).toHaveValue('=B2*2');
    expect(screen.getByRole('textbox', { name: 'D2' })).toHaveValue('=C2+1');
    expect(screen.getByRole('textbox', { name: 'E2' })).toHaveValue('=D2*10');
    expect(screen.getByRole('gridcell', { name: 'C2' })).toHaveTextContent('10');
    expect(screen.getByRole('gridcell', { name: 'D2' })).toHaveTextContent('11');
    expect(screen.getByRole('gridcell', { name: 'E2' })).toHaveTextContent('110');
  });

  it('pressing Enter commits the change and moves the selection; clicking another cell commits as well', async () => {
    const { user } = await openEditor();

    const a2 = screen.getByRole('textbox', { name: 'A2' });
    await user.click(a2);
    await user.clear(a2);
    await user.type(a2, 'West{Enter}');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').A2).toBe('West'));

    // selection moved down and the formula bar follows the new cell (A3 is empty in this seed)
    expect(screen.getByRole('gridcell', { name: 'A3' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('');

    // clicking another cell commits the current entry
    const a3 = screen.getByRole('textbox', { name: 'A3' });
    await user.click(a3);
    await user.clear(a3);
    await user.type(a3, 'West');
    await user.click(screen.getByRole('textbox', { name: 'A4' }));
    await waitFor(() => expect(cellsOf(server, 'q3-sales').A3).toBe('West'));
    expect(screen.getByRole('gridcell', { name: 'A4' })).toHaveAttribute('aria-selected', 'true');
  });

  it('double-clicking a grid cell displays an inline text box named Edit <cell coordinate>; Enter commits and Escape cancels', async () => {
    const { user } = await openEditor();

    const d1 = screen.getByRole('gridcell', { name: 'D1' });
    await user.dblClick(d1);
    const editBox = screen.getByRole('textbox', { name: 'Edit D1' });
    await user.type(editBox, 'East');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').D1).toBe('East'));
    expect(screen.queryByRole('textbox', { name: 'Edit D1' })).toBeNull();
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('East');
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('East');

    // Escape cancels the uncommitted draft without a partial record
    const e1 = screen.getByRole('gridcell', { name: 'E1' });
    await user.dblClick(e1);
    const editBoxE1 = screen.getByRole('textbox', { name: 'Edit E1' });
    await user.type(editBoxE1, '1200');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Edit E1' })).toBeNull();
    expect(cellsOf(server, 'q3-sales').E1).toBeUndefined();
    expect(screen.getByRole('textbox', { name: 'E1' })).toHaveValue('');
  });

  it('clicking another cell commits the double-click edit box draft', async () => {
    const { user } = await openEditor();

    const d1 = screen.getByRole('gridcell', { name: 'D1' });
    await user.dblClick(d1);
    const editBox = screen.getByRole('textbox', { name: 'Edit D1' });
    await user.type(editBox, 'East');
    await user.click(screen.getByRole('textbox', { name: 'D2' }));

    await waitFor(() => expect(cellsOf(server, 'q3-sales').D1).toBe('East'));
    expect(screen.queryByRole('textbox', { name: 'Edit D1' })).toBeNull();
    expect(screen.getByRole('gridcell', { name: 'D2' })).toHaveAttribute('aria-selected', 'true');
  });

  it('a failed commit shows an error while the grid and formula bar keep the last successful value and dependent results stay unchanged', async () => {
    const wb = server.workbooks.get('q3-sales');
    expect(wb).toBeTruthy();
    wb!.sheets[0].cells.B2 = '4';
    wb!.sheets[0].cells.C2 = '=B2*2';
    const { user } = await openEditor();

    const b2 = screen.getByRole('textbox', { name: 'B2' });
    await user.click(b2);
    // The click persists the selection; fail the cell-edit save that follows.
    server.failNextSave = true;
    await user.type(b2, '9');

    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('4'));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('4');
    expect(screen.getByRole('gridcell', { name: 'C2' })).toHaveTextContent('8');
    expect(cellsOf(server, 'q3-sales').B2).toBe('4');
  });
});
