import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createMockServer, seedWorkbook, type MockServer } from './test/mockServer';

describe('REQ-2-1-3 Rename a Worksheet', () => {
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

  function seededSheetNames(): string[] {
    return server.workbooks.get('q3-sales')!.sheets.map((sheet) => sheet.name);
  }

  it('each worksheet tab provides a Worksheet options button whose menu contains a Rename command', async () => {
    const { user } = await openEditor();

    const sheet1Options = screen.getByRole('button', { name: 'Worksheet options for Sheet1' });
    const sheet2Options = screen.getByRole('button', { name: 'Worksheet options for Sheet2' });
    expect(sheet1Options).toHaveAttribute('aria-haspopup', 'menu');
    expect(sheet1Options).toHaveAttribute('aria-expanded', 'false');

    await user.click(sheet1Options);
    expect(sheet1Options).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();

    // clicking the other tab's options switches the open menu
    await user.click(sheet2Options);
    expect(sheet2Options).toHaveAttribute('aria-expanded', 'true');
    expect(sheet1Options).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy();

    // clicking the same options button again closes the menu
    await user.click(sheet2Options);
    expect(sheet2Options).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('the menu supports keyboard dismissal with Escape', async () => {
    const { user } = await openEditor();

    const options = screen.getByRole('button', { name: 'Worksheet options for Sheet1' });
    await user.click(options);
    expect(screen.getByRole('menu')).toBeTruthy();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(options).toHaveAttribute('aria-expanded', 'false');
  });

  it('Rename opens a dialog named "Rename worksheet" prefilled with the current name and a Save button', async () => {
    const { user } = await openEditor();

    await user.click(screen.getByRole('button', { name: 'Worksheet options for Sheet2' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

    const dialog = await screen.findByRole('dialog', { name: 'Rename worksheet' });
    expect(dialog).toBeTruthy();
    expect(screen.getByLabelText('Worksheet name')).toHaveValue('Sheet2');
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('rejects an empty worksheet name with the exact error and keeps the original name', async () => {
    const { user } = await openEditor();

    await user.click(screen.getByRole('button', { name: 'Worksheet options for Sheet1' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = await screen.findByLabelText('Worksheet name');
    await user.clear(input);
    await user.type(input, '   ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Worksheet name cannot be empty'
    );
    expect(screen.getByRole('dialog', { name: 'Rename worksheet' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sheet2' })).toBeTruthy();
    expect(seededSheetNames()).toEqual(['Sheet1', 'Sheet2']);
  });

  it('rejects a duplicate worksheet name with the exact error and keeps the original name', async () => {
    const { user } = await openEditor();

    await user.click(screen.getByRole('button', { name: 'Worksheet options for Sheet1' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = await screen.findByLabelText('Worksheet name');
    await user.clear(input);
    await user.type(input, 'Sheet2');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Worksheet name already exists'
    );
    expect(screen.getByRole('dialog', { name: 'Rename worksheet' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toBeTruthy();
    expect(seededSheetNames()).toEqual(['Sheet1', 'Sheet2']);
  });

  it('a successful rename trims the name, updates the tab, and persists after refresh and reopening', async () => {
    const { user, view } = await openEditor();

    await user.click(screen.getByRole('button', { name: 'Worksheet options for Sheet1' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = await screen.findByLabelText('Worksheet name');
    await user.clear(input);
    await user.type(input, '  Q3 Overview  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(server.workbooks.get('q3-sales')!.sheets[0].name).toBe('Q3 Overview')
    );
    expect(screen.getByRole('tab', { name: 'Q3 Overview' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sheet2' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Sheet1' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Rename worksheet' })).toBeNull();

    // refresh equivalent: remount at the same editor entry restores the new name
    const hash = window.location.hash;
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('tab', { name: 'Q3 Overview' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sheet2' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Sheet1' })).toBeNull();
    expect(window.location.hash).toBe(hash);

    // reopening from the home page entry point restores the saved tab names
    await user.click(screen.getByRole('link', { name: 'Back to workbooks' }));
    await user.click(await screen.findByRole('link', { name: 'Q3 Sales' }));
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('tab', { name: 'Q3 Overview' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sheet2' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Sheet1' })).toBeNull();
  });

  it('when saving fails an error is shown, the original name remains, and a later retry succeeds', async () => {
    const { user } = await openEditor();

    await user.click(screen.getByRole('button', { name: 'Worksheet options for Sheet1' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = await screen.findByLabelText('Worksheet name');
    await user.clear(input);
    await user.type(input, 'Q3 Overview');

    server.failNextSave = true;
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
    expect(screen.getByRole('dialog', { name: 'Rename worksheet' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toBeTruthy();
    expect(seededSheetNames()).toEqual(['Sheet1', 'Sheet2']);

    // retry after the failure applies the new name
    await user.clear(input);
    await user.type(input, 'Q3 Overview');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(server.workbooks.get('q3-sales')!.sheets[0].name).toBe('Q3 Overview')
    );
    expect(screen.getByRole('tab', { name: 'Q3 Overview' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sheet2' })).toBeTruthy();
  });

  it('renaming the inactive worksheet does not touch the active worksheet or its grid values', async () => {
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
    expect(screen.getByRole('tab', { name: 'Totals' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Region');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('1200');
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('North');
    expect(screen.getByRole('textbox', { name: 'B3' })).toHaveValue('800');
  });
});
