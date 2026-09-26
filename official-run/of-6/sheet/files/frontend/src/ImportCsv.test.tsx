import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createMockServer, seedWorkbook, cellsOf, type MockServer } from './test/mockServer';

describe('REQ-1-3-1 Import CSV to Create a Workbook', () => {
  let server: MockServer;

  beforeEach(() => {
    server = createMockServer([seedWorkbook()]);
    vi.stubGlobal('fetch', server.fetch);
    window.location.hash = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('home page has an Import CSV button that opens a named dialog with a CSV file control and Confirm import button', async () => {
    const user = userEvent.setup();
    render(<App />);

    const button = await screen.findByRole('button', { name: 'Import CSV' });
    await user.click(button);

    const dialog = await screen.findByRole('dialog', { name: 'Import CSV' });
    expect(dialog).toBeTruthy();
    expect(screen.getByLabelText('CSV file')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm import' })).toBeTruthy();
  });

  it('importing a UTF-8 CSV creates a workbook named without .csv and opens Sheet1 with the parsed content', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Import CSV' }));
    const fileInput = screen.getByLabelText('CSV file') as HTMLInputElement;
    await user.upload(
      fileInput,
      new File(['Region,East\r\nNorth,1200\r\n800,"Quoted, Value"\n'], 'Sales Data.csv', {
        type: 'text/csv',
      })
    );
    await user.click(screen.getByRole('button', { name: 'Confirm import' }));

    expect(await screen.findByRole('heading', { name: 'Sales Data' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('grid', { name: 'Worksheet grid' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Region');
    expect(screen.getByRole('textbox', { name: 'B1' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('North');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('1200');
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('800');
    expect(screen.getByRole('textbox', { name: 'B3' })).toHaveValue('Quoted, Value');

    const imported = Array.from(server.workbooks.values()).find(
      (wb) => wb.name === 'Sales Data'
    );
    expect(imported).toBeTruthy();
    expect(imported?.sheets).toHaveLength(1);
    expect(imported?.sheets[0].name).toBe('Sheet1');
    expect(imported?.activeSheetId).toBe(imported?.sheets[0].id);
    expect(cellsOf(server, imported!.id).A1).toBe('Region');
    expect(cellsOf(server, imported!.id).B3).toBe('Quoted, Value');
  });

  it('imported content and workbook name persist after refresh and reopening', async () => {
    const user = userEvent.setup();
    const first = render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Import CSV' }));
    const fileInput = screen.getByLabelText('CSV file') as HTMLInputElement;
    await user.upload(fileInput, new File(['产品,价格\n苹果,3\n香蕉,5\n'], '数据.csv'));
    await user.click(screen.getByRole('button', { name: 'Confirm import' }));

    await screen.findByRole('heading', { name: '数据' });
    const imported = Array.from(server.workbooks.values()).find((wb) => wb.name === '数据');
    expect(imported).toBeTruthy();

    // home page shows the imported workbook without the .csv extension
    await user.click(screen.getByRole('link', { name: 'Back to workbooks' }));
    expect(await screen.findByRole('link', { name: '数据' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: '数据.csv' })).toBeNull();

    // reopen from the entry point restores content
    await user.click(screen.getByRole('link', { name: '数据' }));
    expect(await screen.findByRole('heading', { name: '数据' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('产品');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('苹果');
    expect(screen.getByRole('textbox', { name: 'B2' })).toHaveValue('3');

    // refresh equivalent: remount at the same editor state
    const hash = window.location.hash;
    first.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: '数据' });
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('产品');
    expect(screen.getByRole('textbox', { name: 'A3' })).toHaveValue('香蕉');
    expect(window.location.hash).toBe(hash);
  });

  it('invalid CSV is rejected with the exact message and leaves the seed unchanged', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Import CSV' }));
    const fileInput = screen.getByLabelText('CSV file') as HTMLInputElement;
    await user.upload(fileInput, new File(['"unclosed,line\n'], 'broken.csv'));
    await user.click(screen.getByRole('button', { name: 'Confirm import' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid CSV file format. Import failed.'
    );
    expect(screen.getByRole('dialog', { name: 'Import CSV' })).toBeTruthy();
    expect(Array.from(server.workbooks.values()).map((wb) => wb.name)).toEqual(['Q3 Sales']);

    // closing the dialog leaves the home page with only the seeded workbook
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('link', { name: 'Q3 Sales' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'broken' })).toBeNull();
    expect(cellsOf(server, 'q3-sales').A1).toBe('Region');
  });

  it('a failing import request shows the error and creates no partial record', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Import CSV' }));
    server.failNextImport = true;
    const fileInput = screen.getByLabelText('CSV file') as HTMLInputElement;
    await user.upload(fileInput, new File(['a,b\n'], 'sales.csv'));
    await user.click(screen.getByRole('button', { name: 'Confirm import' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Import failed');
    expect(screen.getByRole('dialog', { name: 'Import CSV' })).toBeTruthy();
    expect(Array.from(server.workbooks.values()).map((wb) => wb.name)).toEqual(['Q3 Sales']);
  });

  it('confirming without a file shows a validation message and creates no workbook', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Import CSV' }));
    await user.click(screen.getByRole('button', { name: 'Confirm import' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Please select a CSV file.');
    expect(screen.getByRole('dialog', { name: 'Import CSV' })).toBeTruthy();
    expect(Array.from(server.workbooks.values()).map((wb) => wb.name)).toEqual(['Q3 Sales']);
  });

  it('the seeded workbook and grid remain intact after the import flow', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('link', { name: 'Q3 Sales' }));
    expect(await screen.findByRole('heading', { name: 'Q3 Sales' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Region');

    await user.click(screen.getByRole('link', { name: 'Back to workbooks' }));
    await user.click(await screen.findByRole('button', { name: 'Import CSV' }));
    const fileInput = screen.getByLabelText('CSV file') as HTMLInputElement;
    await user.upload(fileInput, new File(['x\n'], 'extra.csv'));
    await user.click(screen.getByRole('button', { name: 'Confirm import' }));
    await screen.findByRole('heading', { name: 'extra' });

    await user.click(screen.getByRole('link', { name: 'Back to workbooks' }));
    await user.click(await screen.findByRole('link', { name: 'Q3 Sales' }));
    expect(await screen.findByRole('heading', { name: 'Q3 Sales' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Region');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').A1).toBe('Region'));
  });
});
