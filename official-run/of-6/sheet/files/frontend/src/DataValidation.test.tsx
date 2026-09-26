import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createMockServer, cellsOf, type MockServer } from './test/mockServer';
import type { ValidationRule, Workbook } from './types';

// The REQ-5-2-1 evaluation seed: seeded worksheet range A1:C6 with headers
// Region/Sales/Status and rows East/1200/Open, North/800/Closed,
// South/700/Open.
function validationSeedWorkbook(extraRules?: ValidationRule[]): Workbook {
  return {
    id: 'q3-sales',
    name: 'Q3 Sales',
    lastUpdated: '2026-09-25T10:00:00.000Z',
    activeSheetId: 'sheet1',
    sheets: [
      {
        id: 'sheet1',
        name: 'Sheet1',
        rowCount: 6,
        columnCount: 3,
        cells: {
          A1: 'Region',
          B1: 'Sales',
          C1: 'Status',
          A2: 'East',
          B2: '1200',
          C2: 'Open',
          A3: 'North',
          B3: '800',
          C3: 'Closed',
          A4: 'South',
          B4: '700',
          C4: 'Open',
        },
        filterViews: [],
        validationRules: extraRules ?? [],
      },
    ],
    pivots: [],
  };
}

describe('REQ-5-2-1 Set Dropdown or Numeric Validation for a Range', () => {
  let server: MockServer;

  beforeEach(() => {
    server = createMockServer([validationSeedWorkbook()]);
    vi.stubGlobal('fetch', server.fetch);
    window.location.hash = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function activeSheetRules(): ValidationRule[] {
    const wb = server.workbooks.get('q3-sales')!;
    const sheet = wb.sheets.find((s) => s.id === wb.activeSheetId) ?? wb.sheets[0];
    return sheet.validationRules;
  }

  async function openEditor() {
    const user = userEvent.setup();
    const view = render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Q3 Sales' }));
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    return { user, view };
  }

  function selectRange(anchor: string, active: string) {
    fireEvent.mouseDown(screen.getByRole('gridcell', { name: anchor }));
    fireEvent.mouseEnter(screen.getByRole('gridcell', { name: active }));
    fireEvent.mouseUp(window);
  }

  async function openValidationDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Data' }));
    await user.click(screen.getByRole('menuitem', { name: 'Data validation' }));
    return screen.getByRole('dialog', { name: 'Data validation' });
  }

  it('the Data menu provides a Data validation menuitem that opens the named dialog with the required controls', async () => {
    const { user } = await openEditor();

    await user.click(screen.getByRole('button', { name: 'Data' }));
    const menu = screen.getByRole('menu', { name: 'Data menu' });
    const item = within(menu).getByRole('menuitem', { name: 'Data validation' });
    expect(item).toBeTruthy();

    await user.click(item);
    const dialog = screen.getByRole('dialog', { name: 'Data validation' });
    expect(within(dialog).getByRole('combobox', { name: 'Rule type' })).toBeTruthy();
    const ruleType = within(dialog).getByRole('combobox', { name: 'Rule type' });
    expect(
      within(ruleType).getByRole('option', { name: 'Dropdown' })
    ).toBeTruthy();
    expect(
      within(ruleType).getByRole('option', { name: 'Number range' })
    ).toBeTruthy();
    expect(within(dialog).getByRole('textbox', { name: 'Allowed values' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('a dropdown rule on A1:A2 trims allowed values, adds Open dropdown buttons with option-role choices and rejects invalid values', async () => {
    const { user, view } = await openEditor();

    selectRange('A1', 'A2');
    const dialog = await openValidationDialog(user);

    // Rule type defaults to Dropdown; items are trimmed of surrounding spaces
    await user.type(within(dialog).getByRole('textbox', { name: 'Allowed values' }), ' East ,  North ');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    // valid save closes the dialog and the rule is persisted
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Data validation' })).toBeNull()
    );
    await waitFor(() =>
      expect(activeSheetRules()).toEqual([
        { id: expect.any(String), range: 'A1:A2', type: 'dropdown', values: ['East', 'North'] },
      ])
    );

    // every constrained cell exposes "Open dropdown for <cell coordinate>"
    expect(screen.getByRole('button', { name: 'Open dropdown for A1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open dropdown for A2' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open dropdown for A3' })).toBeNull();

    // the options use the ARIA option role and trimmed values as names
    await user.click(screen.getByRole('button', { name: 'Open dropdown for A1' }));
    const east = screen.getByRole('option', { name: 'East' });
    const north = screen.getByRole('option', { name: 'North' });
    expect(east).toBeTruthy();
    expect(north).toBeTruthy();
    expect(screen.queryByRole('option', { name: ' South ' })).toBeNull();

    // choosing an option writes the trimmed value into the cell
    await user.click(north);
    await waitFor(() => expect(cellsOf(server, 'q3-sales').A1).toBe('North'));
    expect(screen.getByRole('gridcell', { name: 'A1' })).toHaveTextContent('North');

    // an invalid dropdown value is rejected with the exact message and the
    // original value remains
    fireEvent.change(screen.getByRole('textbox', { name: 'A2' }), {
      target: { value: 'West' },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please select one of the following values: East, North'
    );
    expect(cellsOf(server, 'q3-sales').A2).toBe('East');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('East');

    // the rule stays active after refresh and the seeded range is untouched
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('button', { name: 'Open dropdown for A1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open dropdown for A2' })).toBeTruthy();
    expect(screen.getByRole('gridcell', { name: 'A3' })).toHaveTextContent('North');
    expect(screen.getByRole('gridcell', { name: 'B2' })).toHaveTextContent('1200');
  });

  it('a 0-to-100 number rule rejects 101 in B3 with the exact boundary message, keeps the value and persists', async () => {
    const { user, view } = await openEditor();

    selectRange('B2', 'B4');
    const dialog = await openValidationDialog(user);
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Rule type' }),
      'Number range'
    );
    await user.type(within(dialog).getByRole('textbox', { name: 'Minimum' }), '0');
    await user.type(within(dialog).getByRole('textbox', { name: 'Maximum' }), '100');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(activeSheetRules()).toEqual([
        { id: expect.any(String), range: 'B2:B4', type: 'number', min: 0, max: 100 },
      ])
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'B3' }), {
      target: { value: '101' },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please enter a number from 0 to 100'
    );
    expect(cellsOf(server, 'q3-sales').B3).toBe('800');
    expect(screen.getByRole('textbox', { name: 'B3' })).toHaveValue('800');

    // an in-range value commits
    fireEvent.change(screen.getByRole('textbox', { name: 'B3' }), {
      target: { value: '99' },
    });
    await waitFor(() => expect(cellsOf(server, 'q3-sales').B3).toBe('99'));

    // persists across refresh; the seeded rows remain
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('gridcell', { name: 'B3' })).toHaveTextContent('99');
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('East');
    expect(screen.getByRole('gridcell', { name: 'C3' })).toHaveTextContent('Closed');
  });

  it('a paste rejected by a dropdown rule keeps every target cell at its original value', async () => {
    const { user } = await openEditor();

    selectRange('A1', 'A2');
    const dialog = await openValidationDialog(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Allowed values' }), 'East,North');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Data validation' })).toBeNull()
    );

    fireEvent.paste(screen.getByRole('grid'), {
      clipboardData: {
        getData: (type: string) => (type === 'text' ? 'North\nWest' : ''),
      },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please select one of the following values: East, North'
    );
    // the whole rectangle is rejected: no partial record
    expect(cellsOf(server, 'q3-sales').A2).toBe('East');
    expect(cellsOf(server, 'q3-sales').B2).toBe('1200');
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Region');
    expect(screen.getByRole('textbox', { name: 'B1' })).toHaveValue('Sales');
  });

  it('reopening an existing rule prefills the dialog and Delete rule removes the constraint without changing cell values', async () => {
    const { user, view } = await openEditor();

    selectRange('A1', 'A2');
    let dialog = await openValidationDialog(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Allowed values' }), 'East,North');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Data validation' })).toBeNull()
    );

    // reopen: the dialog is prefilled with the rule type and parameters and
    // displays a Delete rule button
    await user.click(screen.getByRole('button', { name: 'Data' }));
    await user.click(screen.getByRole('menuitem', { name: 'Data validation' }));
    dialog = screen.getByRole('dialog', { name: 'Data validation' });
    expect(within(dialog).getByRole('combobox', { name: 'Rule type' })).toHaveValue(
      'dropdown'
    );
    expect(within(dialog).getByRole('textbox', { name: 'Allowed values' })).toHaveValue(
      'East, North'
    );
    const deleteButton = within(dialog).getByRole('button', { name: 'Delete rule' });
    expect(deleteButton).toBeTruthy();

    // deleting removes the constraint and closes the dialog
    await user.click(deleteButton);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Data validation' })).toBeNull()
    );
    await waitFor(() => expect(activeSheetRules()).toEqual([]));

    // existing cell values are unchanged
    expect(screen.getByRole('gridcell', { name: 'A1' })).toHaveTextContent('Region');
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('East');
    expect(screen.queryByRole('button', { name: 'Open dropdown for A1' })).toBeNull();

    // after refresh no dropdown buttons remain and the seeded data is intact
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.queryByRole('button', { name: 'Open dropdown for A1' })).toBeNull();
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveTextContent('East');
    expect(screen.getByRole('gridcell', { name: 'A3' })).toHaveTextContent('North');
  });

  it('saving a modification replaces the rule range with the current selection immediately', async () => {
    const { user, view } = await openEditor();

    selectRange('A1', 'A2');
    let dialog = await openValidationDialog(user);
    await user.type(within(dialog).getByRole('textbox', { name: 'Allowed values' }), 'East,North');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Data validation' })).toBeNull()
    );

    // select a wider range and reopen: the rule is edited to the new range
    selectRange('A1', 'A3');
    await user.click(screen.getByRole('button', { name: 'Data' }));
    await user.click(screen.getByRole('menuitem', { name: 'Data validation' }));
    dialog = screen.getByRole('dialog', { name: 'Data validation' });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Data validation' })).toBeNull()
    );
    await waitFor(() =>
      expect(activeSheetRules()).toEqual([
        { id: expect.any(String), range: 'A1:A3', type: 'dropdown', values: ['East', 'North'] },
      ])
    );

    // the new range is effective immediately (A3 now constrained too)
    expect(screen.getByRole('button', { name: 'Open dropdown for A3' })).toBeTruthy();

    // persists after refresh
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('button', { name: 'Open dropdown for A3' })).toBeTruthy();
    expect(screen.getByRole('gridcell', { name: 'A3' })).toHaveTextContent('North');
  });
});
