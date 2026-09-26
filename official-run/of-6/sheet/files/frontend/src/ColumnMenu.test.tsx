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

describe('REQ-2-2-2 Insert and Delete Columns', () => {
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

  function columnHeader(letter: string): HTMLElement {
    return screen.getByRole('columnheader', { name: letter });
  }

  async function openColumnMenu(letter: string) {
    fireEvent.contextMenu(columnHeader(letter));
    await screen.findByRole('menu');
  }

  it('column headers use the columnheader role with the column letter as accessible name; right-clicking opens a menu of menuitem commands', async () => {
    await openEditor();

    expect(screen.getByRole('columnheader', { name: 'A' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'B' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'C' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'D' })).toBeTruthy();

    await openColumnMenu('B');

    expect(screen.getByRole('menuitem', { name: 'Insert 1 column left' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Insert 1 column right' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete column' })).toBeTruthy();
  });

  it('Insert 1 column left shifts the target column and subsequent data right; the blank column is empty and persists after refresh', async () => {
    const { user, view } = await openEditor();

    await openColumnMenu('B');
    await user.click(screen.getByRole('menuitem', { name: 'Insert 1 column left' }));

    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'C2' })).toHaveValue('1200');
    expect(screen.getByRole('textbox', { name: 'C3' })).toHaveValue('800');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('North');
    expect(screen.getByRole('columnheader', { name: 'E' })).toBeTruthy();

    await waitFor(() => {
      const sheet = sheet1Of(server);
      expect(sheet.columnCount).toBe(5);
      expect(sheet.cells.B2).toBeUndefined();
      expect(sheet.cells.C2).toBe('1200');
      expect(sheet.cells.C3).toBe('800');
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
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'C2' })).toHaveValue('1200');
    expect(screen.getByRole('textbox', { name: 'C3' })).toHaveValue('800');
  });

  it('Insert 1 column right inserts a blank column after the target column and keeps the target column in place', async () => {
    const { user } = await openEditor();

    await openColumnMenu('B');
    await user.click(screen.getByRole('menuitem', { name: 'Insert 1 column right' }));

    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('1200');
    expect(screen.getByRole('textbox', { name: 'B3' })).toHaveValue('800');
    expect(screen.getByRole('textbox', { name: 'C2' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('North');
  });

  it('Delete column removes the target column, shifts subsequent columns left and persists after reopen', async () => {
    const { user, view } = await openEditor();

    await openColumnMenu('B');
    await user.click(screen.getByRole('menuitem', { name: 'Delete column' }));

    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Region');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('North');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('');
    expect(screen.queryByRole('columnheader', { name: 'D' })).toBeNull();

    await waitFor(() => {
      const sheet = sheet1Of(server);
      expect(sheet.columnCount).toBe(3);
      expect(sheet.cells.B2).toBeUndefined();
      expect(sheet.cells.A2).toBe('East');
    });

    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('North');
    expect(screen.queryByRole('columnheader', { name: 'D' })).toBeNull();
  });

  it('affected formulas display the adjusted original formula in the formula bar and the correct result in the grid', async () => {
    const wb = workbookOf(server);
    wb.sheets[0].cells.C4 = '=B2+B3';
    const { user } = await openEditor();

    expect(screen.getByRole('gridcell', { name: 'C4' })).toHaveTextContent('2000');
    expect(screen.getByRole('textbox', { name: 'C4' })).toHaveValue('=B2+B3');

    await openColumnMenu('B');
    await user.click(screen.getByRole('menuitem', { name: 'Insert 1 column left' }));

    expect(screen.getByRole('textbox', { name: 'D4' })).toHaveValue('=C2+C3');
    expect(screen.getByRole('gridcell', { name: 'D4' })).toHaveTextContent('2000');

    await user.click(screen.getByRole('textbox', { name: 'D4' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=C2+C3');
  });

  it('formula references to the deleted column display an explicit #REF! error', async () => {
    const wb = workbookOf(server);
    wb.sheets[0].cells.C4 = '=B2+B3';
    const { user } = await openEditor();

    await openColumnMenu('B');
    await user.click(screen.getByRole('menuitem', { name: 'Delete column' }));

    expect(screen.getByRole('textbox', { name: 'B4' })).toHaveValue('=#REF!+#REF!');
    expect(screen.getByRole('gridcell', { name: 'B4' })).toHaveTextContent('#REF!');
    await user.click(screen.getByRole('textbox', { name: 'B4' }));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=#REF!+#REF!');
  });

  it('a shifted 0-to-100 numeric validation rule rejects an out-of-range value with the required message and does not create a partial record', async () => {
    const wb = workbookOf(server);
    wb.sheets[0].validationRules = [
      { id: 'vr1', range: 'B2:C3', type: 'number', min: 0, max: 100 },
    ];
    const { user } = await openEditor();

    // shift the rule right with an insertion left of column B
    await openColumnMenu('B');
    await user.click(screen.getByRole('menuitem', { name: 'Insert 1 column left' }));
    expect(screen.getByText('C2:D3 (number, 0 to 100)')).toBeTruthy();

    const d2 = screen.getByRole('textbox', { name: 'D2' });
    await user.click(d2);
    await user.type(d2, 'abc');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please enter a number from 0 to 100'
    );
    expect(screen.getByRole('textbox', { name: 'D2' })).toHaveValue('');
    expect(sheet1Of(server).cells.D2).toBeUndefined();

    // a later in-range value is accepted
    await user.type(d2, '50');
    await waitFor(() => expect(sheet1Of(server).cells.D2).toBe('50'));
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

    await openColumnMenu('B');
    await user.click(screen.getByRole('menuitem', { name: 'Insert 1 column left' }));

    // result unchanged, refresh command appears
    expect(screen.getByText('Sales pivot (A1:B4)')).toBeTruthy();
    const refresh = screen.getByRole('button', { name: 'Refresh pivot table' });
    await waitFor(() => {
      const pivot = workbookOf(server).pivots[0];
      expect(pivot.sourceRange).toBe('A1:B4');
      expect(pivot.stale).toBe(true);
      expect(pivot.adjustedRange).toBe('A1:C4');
    });

    await user.click(refresh);
    await waitFor(() => {
      const pivot = workbookOf(server).pivots[0];
      expect(pivot.sourceRange).toBe('A1:C4');
      expect(pivot.stale).toBeUndefined();
    });
    expect(screen.getByText('Sales pivot (A1:C4)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh pivot table' })).toBeNull();

    // refresh equivalent: the refreshed range persists
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByText('Sales pivot (A1:C4)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh pivot table' })).toBeNull();
  });

  it('when a pivot source column is deleted, refresh shows a visible error requiring the field to be reselected and preserves the last successful result', async () => {
    const wb = workbookOf(server);
    wb.pivots = [
      { id: 'p1', name: 'Sales pivot', sheetId: wb.sheets[0].id, sourceRange: 'B1:B4' },
    ];
    const { user, view } = await openEditor();

    await openColumnMenu('B');
    await user.click(screen.getByRole('menuitem', { name: 'Delete column' }));

    const refresh = screen.getByRole('button', { name: 'Refresh pivot table' });
    await user.click(refresh);

    // last successful result preserved and a visible error requires reselection
    expect(screen.getByText('Sales pivot (B1:B4)')).toBeTruthy();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please reselect the deleted pivot field'
    );
    await waitFor(() => {
      const pivot = workbookOf(server).pivots[0];
      expect(pivot.sourceRange).toBe('B1:B4');
      expect(pivot.fieldError).toBe(true);
    });

    // the error persists after reopen
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Please reselect the deleted pivot field'
    );
    expect(screen.getByText('Sales pivot (B1:B4)')).toBeTruthy();
  });

  it('when the operation fails an error is displayed and the grid keeps the pre-operation structure after refresh', async () => {
    const { user, view } = await openEditor();

    server.failNextSave = true;
    await openColumnMenu('B');
    await user.click(screen.getByRole('menuitem', { name: 'Insert 1 column left' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
    // grid immediately retains the pre-operation structure
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('1200');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('North');
    const sheet = sheet1Of(server);
    expect(sheet.columnCount).toBe(4);
    expect(sheet.cells.B2).toBe('1200');

    // refresh equivalent keeps the pre-operation structure
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('1200');
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('North');

    // a later successful operation applies the change
    await openColumnMenu('B');
    await user.click(screen.getByRole('menuitem', { name: 'Insert 1 column left' }));
    await waitFor(() => expect(sheet1Of(server).cells.C2).toBe('1200'));
    expect(screen.getByRole('textbox', { name: 'C2' })).toHaveValue('1200');
  });

  it('Escape closes the column menu; Enter on a focused column header opens it', async () => {
    const { user } = await openEditor();

    await openColumnMenu('B');
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.keyDown(columnHeader('C'), { key: 'Enter' });
    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete column' })).toBeTruthy();
  });
});
