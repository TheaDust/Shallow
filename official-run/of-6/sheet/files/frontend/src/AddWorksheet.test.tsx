import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createMockServer, seedWorkbook, type MockServer } from './test/mockServer';

describe('REQ-2-1-1 Add a Worksheet', () => {
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

  it('the editor tab bar provides a button with the accessible name "Add worksheet"', async () => {
    await openEditor();
    const button = screen.getByRole('button', { name: 'Add worksheet' });
    expect(button).toBeTruthy();
    expect(button.closest('.sheet-tabs')).toBeTruthy();
  });

  it('clicking Add worksheet creates the first unused SheetN tab, makes it active with A1 selected, and leaves existing sheets untouched', async () => {
    const { user } = await openEditor();

    await user.click(screen.getByRole('button', { name: 'Add worksheet' }));

    const newTab = await screen.findByRole('tab', { name: 'Sheet3' });
    expect(newTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    expect(screen.getByRole('tab', { name: 'Sheet2' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    expect(screen.getAllByRole('tab')).toHaveLength(3);

    expect(screen.getByRole('gridcell', { name: 'A1' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('');

    // the new worksheet is blank and does not inherit filters, validation or pivots
    expect(screen.getByText('No filter views')).toBeTruthy();
    expect(screen.getByText('No validation rules')).toBeTruthy();
    expect(screen.getByText('No pivot table results')).toBeTruthy();

    // server state: the new sheet is active and blank, existing sheets unchanged
    await waitFor(() => {
      const wb = server.workbooks.get('q3-sales')!;
      expect(wb.sheets.map((s) => s.name)).toEqual(['Sheet1', 'Sheet2', 'Sheet3']);
      expect(wb.activeSheetId).toBe(wb.sheets[2].id);
      expect(wb.sheets[2].cells).toEqual({});
      expect(wb.sheets[2].filterViews).toEqual([]);
      expect(wb.sheets[2].validationRules).toEqual([]);
      expect(wb.sheets[0].cells.A1).toBe('Region');
      expect(wb.sheets[0].cells.B3).toBe('800');
    });

    // existing worksheets and their data remain unchanged
    await user.click(screen.getByRole('tab', { name: 'Sheet1' }));
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Region');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('1200');
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('North');
    expect(screen.getByRole('textbox', { name: 'B3' })).toHaveValue('800');
    expect(server.workbooks.get('q3-sales')!.sheets[1].cells).toEqual({});
  });

  it('the new tab persists after refresh and after reopening from the home page', async () => {
    const { user, view } = await openEditor();

    await user.click(screen.getByRole('button', { name: 'Add worksheet' }));
    await screen.findByRole('tab', { name: 'Sheet3' });
    await waitFor(() => expect(server.workbooks.get('q3-sales')!.sheets).toHaveLength(3));

    // refresh equivalent: remount at the same editor entry
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('tab', { name: 'Sheet3' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sheet2' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('');

    // reopening from the home entry point restores the added tab and keeps it active
    await user.click(screen.getByRole('link', { name: 'Back to workbooks' }));
    await user.click(await screen.findByRole('link', { name: 'Q3 Sales' }));
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('tab', { name: 'Sheet3' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sheet2' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('');
    await user.click(screen.getByRole('tab', { name: 'Sheet1' }));
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'B3' })).toHaveValue('800');
  });

  it('when adding fails an error is shown, no new tab appears, and existing worksheets remain unchanged', async () => {
    const { user } = await openEditor();

    server.failNextSave = true;
    await user.click(screen.getByRole('button', { name: 'Add worksheet' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
    expect(screen.queryByRole('tab', { name: 'Sheet3' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('tab', { name: 'Sheet2' })).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(2);

    const wb = server.workbooks.get('q3-sales')!;
    expect(wb.sheets.map((s) => s.name)).toEqual(['Sheet1', 'Sheet2']);
    expect(wb.activeSheetId).toBe(wb.sheets[0].id);
    expect(wb.sheets[0].cells.A1).toBe('Region');
    expect(wb.sheets[0].cells.A2).toBe('East');
    expect(wb.sheets[0].cells.B2).toBe('1200');
    expect(wb.sheets[0].cells.A3).toBe('North');
    expect(wb.sheets[0].cells.B3).toBe('800');

    // a later successful add still works
    await user.click(screen.getByRole('button', { name: 'Add worksheet' }));
    expect(await screen.findByRole('tab', { name: 'Sheet3' })).toBeTruthy();
  });

  it('uses the first unused SheetN name after a sheet has been renamed away', async () => {
    const { user } = await openEditor();

    await user.click(screen.getByRole('button', { name: 'Worksheet options for Sheet2' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = await screen.findByLabelText('Worksheet name');
    await user.clear(input);
    await user.type(input, 'Totals');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(server.workbooks.get('q3-sales')!.sheets[1].name).toBe('Totals')
    );

    await user.click(screen.getByRole('button', { name: 'Add worksheet' }));
    const reusedTab = await screen.findByRole('tab', { name: 'Sheet2' });
    expect(reusedTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Totals' })).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('');
  });
});
