import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createMockServer, cellsOf, type MockServer } from './test/mockServer';
import { setInternalClipboard } from './internalClipboard';
import type { Workbook } from './types';

// The REQ-3-2-1 evaluation seed: seeded workbook Q3 Sales, range A1:B2
// containing Item/Qty and Pen/4, target range D1:E2 (empty).
function copyPasteSeedWorkbook(extra?: Partial<Workbook['sheets'][number]>): Workbook {
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

describe('REQ-3-2-1 Copy, Cut, and Paste Cell Ranges', () => {
  let server: MockServer;

  beforeEach(() => {
    server = createMockServer([copyPasteSeedWorkbook()]);
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
  const cutEvent = () =>
    fireEvent.cut(screen.getByRole('grid'), { clipboardData: { setData: () => {} } });
  const pasteEvent = () =>
    fireEvent.paste(screen.getByRole('grid'), {
      clipboardData: { getData: (type: string) => (type === 'text' ? 'ignored' : '') },
    });

  function expectSourceIntact() {
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Item/Qty');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('Pen/4');
    expect(screen.getByRole('textbox', { name: 'B1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('');
  }

  function expectTargetFilled() {
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('Item/Qty');
    expect(screen.getByRole('gridcell', { name: 'D2' })).toHaveTextContent('Pen/4');
    expect(screen.getByRole('gridcell', { name: 'E1' })).toHaveTextContent('');
    expect(screen.getByRole('gridcell', { name: 'E2' })).toHaveTextContent('');
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('Item/Qty');
    expect(screen.getByRole('textbox', { name: 'D2' })).toHaveValue('Pen/4');
    expect(screen.getByRole('textbox', { name: 'E1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'E2' })).toHaveValue('');
  }

  it('copying A1:B2 and pasting at D1 fills D1:E2, keeps the source unchanged and persists after refresh', async () => {
    const { user, view } = await openEditor();

    dragSelect('A1', 'B2');
    copyEvent();
    await user.click(screen.getByRole('textbox', { name: 'D1' }));
    pasteEvent();

    await waitFor(() => expect(cellsOf(server, 'q3-sales').D2).toBe('Pen/4'));
    expectTargetFilled();
    expectSourceIntact();
    // cells outside the source and target ranges must not change
    expect(screen.getByRole('textbox', { name: 'C1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'C2' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'F1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'D3' })).toHaveValue('');
    expect(cellsOf(server, 'q3-sales').C1).toBeUndefined();
    expect(cellsOf(server, 'q3-sales').C2).toBeUndefined();
    expect(cellsOf(server, 'q3-sales').F1).toBeUndefined();
    expect(cellsOf(server, 'q3-sales').D3).toBeUndefined();

    // refresh: the successful result and the unchanged source persist
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expectTargetFilled();
    expectSourceIntact();
    expect(cellsOf(server, 'q3-sales').A1).toBe('Item/Qty');
    expect(cellsOf(server, 'q3-sales').A2).toBe('Pen/4');
    expect(cellsOf(server, 'q3-sales').D1).toBe('Item/Qty');
    expect(cellsOf(server, 'q3-sales').D2).toBe('Pen/4');
  });

  it('toolbar Copy and Paste buttons perform the same workflow', async () => {
    const { user, view } = await openEditor();

    dragSelect('A1', 'B2');
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    await user.click(screen.getByRole('textbox', { name: 'D1' }));
    await user.click(screen.getByRole('button', { name: 'Paste' }));

    await waitFor(() => expect(cellsOf(server, 'q3-sales').D2).toBe('Pen/4'));
    expectTargetFilled();
    expectSourceIntact();

    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expectTargetFilled();
    expectSourceIntact();
  });

  it('cutting A1:B2 and pasting at D1 clears the source after the target is displayed and persists', async () => {
    const { user, view } = await openEditor();

    dragSelect('A1', 'B2');
    cutEvent();
    await user.click(screen.getByRole('textbox', { name: 'D1' }));
    pasteEvent();

    await waitFor(() => expect(cellsOf(server, 'q3-sales').D2).toBe('Pen/4'));
    expectTargetFilled();
    // the source range is cleared
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'B1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('');
    expect(cellsOf(server, 'q3-sales').A1).toBeUndefined();
    expect(cellsOf(server, 'q3-sales').A2).toBeUndefined();
    expect(cellsOf(server, 'q3-sales').B1).toBeUndefined();
    expect(cellsOf(server, 'q3-sales').B2).toBeUndefined();

    // refresh: the move persists (target filled, source cleared)
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expectTargetFilled();
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('');
  });

  it('toolbar Cut followed by Paste clears the source and fills the target', async () => {
    const { user } = await openEditor();

    dragSelect('A1', 'B2');
    await user.click(screen.getByRole('button', { name: 'Cut' }));
    await user.click(screen.getByRole('textbox', { name: 'D1' }));
    await user.click(screen.getByRole('button', { name: 'Paste' }));

    await waitFor(() => expect(cellsOf(server, 'q3-sales').D2).toBe('Pen/4'));
    expectTargetFilled();
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('');
    expect(cellsOf(server, 'q3-sales').A1).toBeUndefined();
  });

  it('copying a formula adjusts relative references by the offset and shows the adjusted formula in the formula bar', async () => {
    const wb = server.workbooks.get('q3-sales');
    expect(wb).toBeTruthy();
    wb!.sheets[0].cells.A1 = '=B2+1';
    wb!.sheets[0].cells.B2 = '4';
    const { user, view } = await openEditor();

    dragSelect('A1', 'B2');
    copyEvent();
    await user.click(screen.getByRole('textbox', { name: 'D1' }));
    pasteEvent();

    await waitFor(() => expect(cellsOf(server, 'q3-sales').D1).toBe('=E2+1'));
    // the pasted formula computes from the pasted values (E2 = 4)
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('5');
    // the formula bar displays the adjusted original formula
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=E2+1');
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('=E2+1');
    // the source formula itself remains unchanged
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('=B2+1');

    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('=E2+1');
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('5');
  });

  it('copying a formula keeps absolute references unchanged and still computes', async () => {
    const wb = server.workbooks.get('q3-sales');
    expect(wb).toBeTruthy();
    wb!.sheets[0].cells.A1 = '=$B$2+1';
    wb!.sheets[0].cells.B2 = '4';
    const { user } = await openEditor();

    dragSelect('A1', 'B2');
    copyEvent();
    await user.click(screen.getByRole('textbox', { name: 'D1' }));
    pasteEvent();

    await waitFor(() => expect(cellsOf(server, 'q3-sales').D1).toBe('=$B$2+1'));
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('=$B$2+1');
    // absolute reference still resolves to B2 = 4
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveTextContent('5');
  });

  it('a 0-to-100 numeric validation rule rejects a copy paste with the exact message and no partial record', async () => {
    const wb = server.workbooks.get('q3-sales');
    expect(wb).toBeTruthy();
    wb!.sheets[0].validationRules = [
      { id: 'vr1', range: 'D1:E2', type: 'number', min: 0, max: 100 },
    ];
    const { user, view } = await openEditor();

    dragSelect('A1', 'B2');
    copyEvent();
    await user.click(screen.getByRole('textbox', { name: 'D1' }));
    pasteEvent();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please enter a number from 0 to 100'
    );

    // every target cell retains its original (empty) value and nothing saved
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'E1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'D2' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'E2' })).toHaveValue('');
    expect(cellsOf(server, 'q3-sales').D1).toBeUndefined();
    expect(cellsOf(server, 'q3-sales').E2).toBeUndefined();
    // the copied source range remains unchanged
    expectSourceIntact();

    // refresh: the original seeded state remains unchanged
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Item/Qty');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('Pen/4');
  });

  it('a rejected cut paste leaves the source range intact', async () => {
    const wb = server.workbooks.get('q3-sales');
    expect(wb).toBeTruthy();
    wb!.sheets[0].validationRules = [
      { id: 'vr1', range: 'D1:E2', type: 'number', min: 0, max: 100 },
    ];
    const { user } = await openEditor();

    dragSelect('A1', 'B2');
    cutEvent();
    await user.click(screen.getByRole('textbox', { name: 'D1' }));
    pasteEvent();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please enter a number from 0 to 100'
    );
    // cut does not clear the source when the paste is rejected
    expectSourceIntact();
    expect(cellsOf(server, 'q3-sales').A1).toBe('Item/Qty');
    expect(cellsOf(server, 'q3-sales').A2).toBe('Pen/4');
    expect(screen.getByRole('textbox', { name: 'D1' })).toHaveValue('');
  });

  it('the cell context menu provides Copy, Cut and Paste commands', async () => {
    const { user, view } = await openEditor();

    // select A1:B2, then right-click inside the selection to keep it
    dragSelect('A1', 'B2');
    fireEvent.contextMenu(screen.getByRole('gridcell', { name: 'A1' }));
    await user.click(screen.getByRole('menuitem', { name: 'Copy' }));
    expect(screen.queryByRole('menuitem', { name: 'Copy' })).toBeNull();

    await user.click(screen.getByRole('textbox', { name: 'D1' }));
    fireEvent.contextMenu(screen.getByRole('gridcell', { name: 'D1' }));
    await user.click(screen.getByRole('menuitem', { name: 'Paste' }));

    await waitFor(() => expect(cellsOf(server, 'q3-sales').D2).toBe('Pen/4'));
    expectTargetFilled();
    expectSourceIntact();

    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expectTargetFilled();
    expectSourceIntact();
  });

  it('the cell context menu Cut command cuts the whole selected range on paste', async () => {
    const { user } = await openEditor();

    dragSelect('A1', 'B2');
    fireEvent.contextMenu(screen.getByRole('gridcell', { name: 'B2' }));
    await user.click(screen.getByRole('menuitem', { name: 'Cut' }));

    await user.click(screen.getByRole('textbox', { name: 'D1' }));
    fireEvent.contextMenu(screen.getByRole('gridcell', { name: 'D1' }));
    await user.click(screen.getByRole('menuitem', { name: 'Paste' }));

    await waitFor(() => expect(cellsOf(server, 'q3-sales').D2).toBe('Pen/4'));
    expectTargetFilled();
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('');
    expect(cellsOf(server, 'q3-sales').A1).toBeUndefined();
    expect(cellsOf(server, 'q3-sales').A2).toBeUndefined();
  });
});
