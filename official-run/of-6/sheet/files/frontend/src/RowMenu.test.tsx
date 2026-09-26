import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createMockServer, seedWorkbook, type MockServer } from './test/mockServer';
import type { Workbook } from './types';

function workbookOf(server: MockServer): Workbook {
  return server.workbooks.get('q3-sales')!;
}

function sheet1Of(server: MockServer): Workbook['sheets'][number] {
  return workbookOf(server).sheets[0];
}

describe('REQ-2-2-1 Insert and Delete Rows', () => {
  let server: MockServer;

  beforeEach(() => {
    server = createMockServer([seedWorkbook()]);
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

  function rowHeader(row: number): HTMLElement {
    return screen.getByRole('rowheader', { name: String(row) });
  }

  async function openRowMenu(row: number) {
    fireEvent.contextMenu(rowHeader(row));
    await screen.findByRole('menu');
  }

  it('row numbers use the rowheader role with the decimal row number as accessible name; right-clicking opens a menu of menuitem commands', async () => {
    await openEditor();

    expect(screen.getByRole('rowheader', { name: '1' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: '2' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: '3' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: '4' })).toBeTruthy();

    await openRowMenu(2);

    expect(screen.getByRole('menuitem', { name: 'Insert 1 row above' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Insert 1 row below' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete row' })).toBeTruthy();
  });

  it('Insert 1 row above shifts the target row and subsequent records down; the blank row is empty and persists after refresh', async () => {
    const { user, view } = await openEditor();

    await openRowMenu(2);
    await user.click(screen.getByRole('menuitem', { name: 'Insert 1 row above' }));

    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'B3' })).toHaveValue('1200');
    expect(screen.getByRole('textbox', { name: 'A4' })).toHaveValue('North');
    expect(screen.getByRole('textbox', { name: 'B4' })).toHaveValue('800');
    expect(screen.getByRole('rowheader', { name: '5' })).toBeTruthy();

    await waitFor(() => {
      const sheet = sheet1Of(server);
      expect(sheet.rowCount).toBe(5);
      expect(sheet.cells.A2).toBeUndefined();
      expect(sheet.cells.A3).toBe('East');
      expect(sheet.cells.B3).toBe('1200');
      expect(sheet.cells.A4).toBe('North');
      expect(sheet.cells.B4).toBe('800');
      expect(sheet.cells.A1).toBe('Region');
    });

    // other worksheets remain unchanged
    await user.click(screen.getByRole('tab', { name: 'Sheet2' }));
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('');
    expect(workbookOf(server).sheets[1].cells).toEqual({});
    await user.click(screen.getByRole('tab', { name: 'Sheet1' }));

    // refresh equivalent: remount at the same editor entry
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'A4' })).toHaveValue('North');
  });

  it('Insert 1 row below inserts a blank row under the target row and keeps the target row in place', async () => {
    const { user } = await openEditor();

    await openRowMenu(2);
    await user.click(screen.getByRole('menuitem', { name: 'Insert 1 row below' }));

    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('1200');
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'A4' })).toHaveValue('North');
    expect(screen.getByRole('textbox', { name: 'B4' })).toHaveValue('800');
  });

  it('Delete row removes the target row, shifts subsequent rows up and persists after reopen', async () => {
    const { user, view } = await openEditor();

    await openRowMenu(2);
    await user.click(screen.getByRole('menuitem', { name: 'Delete row' }));

    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Region');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('North');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('800');
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('');
    expect(screen.queryByRole('textbox', { name: 'A4' })).toBeNull();

    await waitFor(() => {
      const sheet = sheet1Of(server);
      expect(sheet.rowCount).toBe(3);
      expect(sheet.cells.A2).toBe('North');
      expect(sheet.cells.B2).toBe('800');
      expect(sheet.cells.A3).toBeUndefined();
    });

    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('North');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('800');
  });

  it('affected formulas display the adjusted original formula in the formula bar and the correct result in the grid', async () => {
    const wb = workbookOf(server);
    wb.sheets[0].cells.B4 = '=B2+B3';
    const { user } = await openEditor();

    expect(screen.getByRole('gridcell', { name: 'B4' })).toHaveTextContent('2000');
    expect(screen.getByRole('textbox', { name: 'B4' })).toHaveValue('=B2+B3');

    await openRowMenu(2);
    await user.click(screen.getByRole('menuitem', { name: 'Insert 1 row above' }));

    expect(screen.getByRole('textbox', { name: 'B5' })).toHaveValue('=B3+B4');
    expect(screen.getByRole('gridcell', { name: 'B5' })).toHaveTextContent('2000');

    await user.click(screen.getByRole('textbox', { name: 'B5' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=B3+B4');
  });

  it('formula references to the deleted row display an explicit #REF! error', async () => {
    const wb = workbookOf(server);
    wb.sheets[0].cells.B4 = '=B2+B3';
    const { user } = await openEditor();

    await openRowMenu(2);
    await user.click(screen.getByRole('menuitem', { name: 'Delete row' }));

    expect(screen.getByRole('textbox', { name: 'B3' })).toHaveValue('=#REF!+B2');
    expect(screen.getByRole('gridcell', { name: 'B3' })).toHaveTextContent('#REF!');
    await user.click(screen.getByRole('textbox', { name: 'B3' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=#REF!+B2');
  });

  it('a shifted 0-to-100 numeric validation rule rejects an out-of-range value with the required message and does not create a partial record', async () => {
    const wb = workbookOf(server);
    wb.sheets[0].validationRules = [
      { id: 'vr1', range: 'B2:C4', type: 'number', min: 0, max: 100 },
    ];
    const { user } = await openEditor();

    // shift the rule down with an insertion above row 2
    await openRowMenu(2);
    await user.click(screen.getByRole('menuitem', { name: 'Insert 1 row above' }));
    expect(screen.getByText('B3:C5 (number, 0 to 100)')).toBeTruthy();

    const c3 = screen.getByRole('textbox', { name: 'C3' });
    await user.click(c3);
    await user.type(c3, 'abc');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please enter a number from 0 to 100'
    );
    expect(screen.getByRole('textbox', { name: 'C3' })).toHaveValue('');
    expect(sheet1Of(server).cells.C3).toBeUndefined();

    // a later in-range value is accepted
    await user.type(c3, '50');
    await waitFor(() => expect(sheet1Of(server).cells.C3).toBe('50'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a change overlapping a pivot source range keeps the pivot result unchanged until Refresh pivot table is clicked', async () => {
    const wb = workbookOf(server);
    wb.pivots = [
      { id: 'p1', name: 'Sales pivot', sheetId: wb.sheets[0].id, sourceRange: 'A1:B4' },
    ];
    const { user, view } = await openEditor();

    expect(screen.getByText('Sales pivot (A1:B4)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh pivot table' })).toBeNull();

    await openRowMenu(2);
    await user.click(screen.getByRole('menuitem', { name: 'Insert 1 row above' }));

    // result unchanged, refresh command appears
    expect(screen.getByText('Sales pivot (A1:B4)')).toBeTruthy();
    const refresh = screen.getByRole('button', { name: 'Refresh pivot table' });
    await waitFor(() => {
      const pivot = workbookOf(server).pivots[0];
      expect(pivot.sourceRange).toBe('A1:B4');
      expect(pivot.stale).toBe(true);
      expect(pivot.adjustedRange).toBe('A1:B5');
    });

    await user.click(refresh);
    await waitFor(() => {
      const pivot = workbookOf(server).pivots[0];
      expect(pivot.sourceRange).toBe('A1:B5');
      expect(pivot.stale).toBeUndefined();
    });
    expect(screen.getByText('Sales pivot (A1:B5)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh pivot table' })).toBeNull();

    // refresh equivalent: the refreshed range persists
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByText('Sales pivot (A1:B5)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh pivot table' })).toBeNull();
  });

  it('when the operation fails an error is displayed and the grid keeps the pre-operation structure after refresh', async () => {
    const { user, view } = await openEditor();

    server.failNextSave = true;
    await openRowMenu(2);
    await user.click(screen.getByRole('menuitem', { name: 'Insert 1 row above' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
    // grid immediately retains the pre-operation structure
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('1200');
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('North');
    expect(screen.getByRole('textbox', { name: 'B3' })).toHaveValue('800');
    const sheet = sheet1Of(server);
    expect(sheet.rowCount).toBe(4);
    expect(sheet.cells.A2).toBe('East');

    // refresh equivalent keeps the pre-operation structure
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('North');

    // a later successful operation applies the change
    await openRowMenu(2);
    await user.click(screen.getByRole('menuitem', { name: 'Insert 1 row above' }));
    await waitFor(() => expect(sheet1Of(server).cells.A3).toBe('East'));
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('East');
  });

  it('Escape closes the row menu; Enter on a focused row number opens it', async () => {
    const { user } = await openEditor();

    await openRowMenu(2);
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.keyDown(rowHeader(3), { key: 'Enter' });
    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete row' })).toBeTruthy();
  });
});
