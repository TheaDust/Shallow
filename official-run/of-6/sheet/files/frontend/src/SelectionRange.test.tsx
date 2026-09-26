import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createMockServer, type MockServer } from './test/mockServer';
import type { Sheet, Workbook } from './types';

// The REQ-3-1-3 evaluation seed: seeded workbook Q3 Sales, range A1:B2
// containing Item/Qty and Pen/4, and target range D1:E2.
function selectionSeedWorkbook(): Workbook {
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
      {
        id: 'sheet2',
        name: 'Sheet2',
        rowCount: 20,
        columnCount: 6,
        cells: {},
        filterViews: [],
        validationRules: [],
      },
    ],
    pivots: [],
  };
}

describe('REQ-3-1-3 Select a Rectangular Cell Range', () => {
  let server: MockServer;

  beforeEach(() => {
    server = createMockServer([selectionSeedWorkbook()]);
    vi.stubGlobal('fetch', server.fetch);
    window.location.hash = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function activeSheet(): Sheet {
    const wb = server.workbooks.get('q3-sales')!;
    return wb.sheets.find((s) => s.id === wb.activeSheetId) ?? wb.sheets[0];
  }

  async function openEditor() {
    const user = userEvent.setup();
    const view = render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Q3 Sales' }));
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    return { user, view };
  }

  it('the grid exposes aria-multiselectable and clicking a cell selects it, updates the formula bar and persists the selection', async () => {
    const { user } = await openEditor();

    const grid = screen.getByRole('grid', { name: 'Worksheet grid' });
    expect(grid).toHaveAttribute('aria-multiselectable', 'true');

    // default selection is the first cell
    expect(screen.getByRole('gridcell', { name: 'A1' })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    // click D1: the single cell is selected, everything else outside it is not
    await user.click(screen.getByRole('textbox', { name: 'D1' }));
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('gridcell', { name: 'A1' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    expect(screen.getByRole('gridcell', { name: 'E1' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    expect(screen.getByRole('gridcell', { name: 'D2' })).toHaveAttribute(
      'aria-selected',
      'false'
    );

    // the formula bar follows the selected cell (D1 is empty in this seed)
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('');

    // the complete single-cell rectangle is persisted, not just shown locally
    await waitFor(() => expect(activeSheet().selection).toEqual({ anchor: 'D1', active: 'D1' }));
  });

  it('dragging from one corner to the diagonally opposite cell selects the complete rectangle, visibly and in ARIA, and persists the full rectangle', async () => {
    await openEditor();

    const d1 = screen.getByRole('gridcell', { name: 'D1' });
    fireEvent.mouseDown(d1);
    fireEvent.mouseEnter(screen.getByRole('gridcell', { name: 'E1' }));
    fireEvent.mouseEnter(screen.getByRole('gridcell', { name: 'D2' }));
    fireEvent.mouseEnter(screen.getByRole('gridcell', { name: 'E2' }));
    fireEvent.mouseUp(window);

    // every gridcell inside the rectangle exposes aria-selected=true
    for (const coord of ['D1', 'E1', 'D2', 'E2']) {
      expect(screen.getByRole('gridcell', { name: coord })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      // visible indication of the complete selection
      expect(screen.getByRole('gridcell', { name: coord })).toHaveClass('selected');
    }
    // every gridcell outside the rectangle exposes aria-selected=false
    for (const coord of ['A1', 'B2', 'C1', 'F1', 'D3']) {
      expect(screen.getByRole('gridcell', { name: coord })).toHaveAttribute(
        'aria-selected',
        'false'
      );
    }
    expect(screen.getByRole('gridcell', { name: 'A1' })).not.toHaveClass('selected');

    // the complete rectangle (both corners) is persisted, not just the corner
    await waitFor(() =>
      expect(activeSheet().selection).toEqual({ anchor: 'D1', active: 'E2' })
    );
  });

  it('after a refresh the saved rectangle is restored exactly, with aria-selected inside and outside matching the saved state', async () => {
    const { view } = await openEditor();

    fireEvent.mouseDown(screen.getByRole('gridcell', { name: 'D1' }));
    fireEvent.mouseEnter(screen.getByRole('gridcell', { name: 'E2' }));
    fireEvent.mouseUp(window);
    await waitFor(() =>
      expect(activeSheet().selection).toEqual({ anchor: 'D1', active: 'E2' })
    );

    // refresh and return to the same worksheet directly
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });

    for (const coord of ['D1', 'E1', 'D2', 'E2']) {
      expect(screen.getByRole('gridcell', { name: coord })).toHaveAttribute(
        'aria-selected',
        'true'
      );
    }
    for (const coord of ['A1', 'B2', 'C1', 'F2', 'D3']) {
      expect(screen.getByRole('gridcell', { name: coord })).toHaveAttribute(
        'aria-selected',
        'false'
      );
    }
    // the seeded A1:B2 range is still intact after the refresh
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Item/Qty');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('Pen/4');
    expect(screen.getByRole('textbox', { name: 'B1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('');
  });

  it('selecting another cell or range replaces the previous selection and updates the ARIA state and the store', async () => {
    const { user } = await openEditor();

    fireEvent.mouseDown(screen.getByRole('gridcell', { name: 'D1' }));
    fireEvent.mouseEnter(screen.getByRole('gridcell', { name: 'E2' }));
    fireEvent.mouseUp(window);
    await waitFor(() =>
      expect(activeSheet().selection).toEqual({ anchor: 'D1', active: 'E2' })
    );

    // a single click replaces the whole previous rectangle
    await user.click(screen.getByRole('textbox', { name: 'C3' }));
    expect(screen.getByRole('gridcell', { name: 'C3' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    expect(screen.getByRole('gridcell', { name: 'E2' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    await waitFor(() =>
      expect(activeSheet().selection).toEqual({ anchor: 'C3', active: 'C3' })
    );
  });

  it('switching to another worksheet restores its own selection and does not overwrite the original worksheet selection', async () => {
    const { user, view } = await openEditor();

    // Sheet1: select the target range D1:E2
    fireEvent.mouseDown(screen.getByRole('gridcell', { name: 'D1' }));
    fireEvent.mouseEnter(screen.getByRole('gridcell', { name: 'E2' }));
    fireEvent.mouseUp(window);
    await waitFor(() =>
      expect(activeSheet().selection).toEqual({ anchor: 'D1', active: 'E2' })
    );

    // switch to Sheet2 (no saved selection -> A1) and back to Sheet1
    await user.click(screen.getByRole('tab', { name: 'Sheet2' }));
    expect(screen.getByRole('gridcell', { name: 'A1' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    // the original worksheet keeps its saved rectangle
    expect(activeSheet().selection).toBeUndefined();
    const sheet1 = server.workbooks.get('q3-sales')!.sheets.find((s) => s.id === 'sheet1')!;
    expect(sheet1.selection).toEqual({ anchor: 'D1', active: 'E2' });

    await user.click(screen.getByRole('tab', { name: 'Sheet1' }));
    for (const coord of ['D1', 'E1', 'D2', 'E2']) {
      expect(screen.getByRole('gridcell', { name: coord })).toHaveAttribute(
        'aria-selected',
        'true'
      );
    }
    expect(screen.getByRole('gridcell', { name: 'A1' })).toHaveAttribute(
      'aria-selected',
      'false'
    );

    // the separation survives a refresh: Sheet1 still shows D1:E2
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    for (const coord of ['D1', 'E1', 'D2', 'E2']) {
      expect(screen.getByRole('gridcell', { name: coord })).toHaveAttribute(
        'aria-selected',
        'true'
      );
    }
  });

  it('Shift+Arrow extends the selection rectangle and persists it', async () => {
    const { user } = await openEditor();

    const d1 = screen.getByRole('textbox', { name: 'D1' });
    await user.click(d1);
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');

    expect(screen.getByRole('gridcell', { name: 'D1' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('gridcell', { name: 'D2' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('gridcell', { name: 'E1' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    await waitFor(() =>
      expect(activeSheet().selection).toEqual({ anchor: 'D1', active: 'D2' })
    );
  });

  it('a failed selection save keeps the previously stored selection unchanged and shows the error', async () => {
    const { user } = await openEditor();

    // first establish a stored selection
    await user.click(screen.getByRole('textbox', { name: 'B2' }));
    await waitFor(() =>
      expect(activeSheet().selection).toEqual({ anchor: 'B2', active: 'B2' })
    );

    // the next selection change fails to save
    server.failNextSave = true;
    fireEvent.mouseDown(screen.getByRole('gridcell', { name: 'C3' }));
    fireEvent.mouseUp(window);

    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
    await waitFor(() => expect(activeSheet().selection).toEqual({ anchor: 'B2', active: 'B2' }));
    expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });
});
