import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createMockServer, seedWorkbook, cellsOf, type MockServer } from './test/mockServer';

describe('REQ-1-3-2 Export the Current Worksheet as CSV', () => {
  let server: MockServer;
  let createObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    server = createMockServer([seedWorkbook()]);
    vi.stubGlobal('fetch', server.fetch);
    window.location.hash = '';
    createObjectURL = vi.fn(() => 'blob:mock-url');
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURL,
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
    });
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

  async function lastDownloadText(): Promise<string> {
    const calls = createObjectURL.mock.calls;
    const blob = calls[calls.length - 1][0] as Blob;
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
      reader.readAsText(blob, 'UTF-8');
    });
  }

  function captureDownloadAnchor(): { anchor: () => HTMLAnchorElement | null; restore: () => void } {
    let captured: HTMLAnchorElement | null = null;
    const spy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        captured = this;
        return undefined;
      });
    return {
      anchor: () => captured,
      restore: () => spy.mockRestore(),
    };
  }

  it('shows an Export CSV button on the workbook editor toolbar', async () => {
    await openEditor();

    const toolbar = screen.getByRole('toolbar', { name: 'Workbook toolbar' });
    expect(toolbar).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Export CSV' });
    expect(toolbar.contains(button)).toBe(true);
  });

  it('clicking Export CSV starts a download whose filename ends with .csv and whose text is the grid CSV in order', async () => {
    const { user } = await openEditor();

    const a2 = screen.getByRole('textbox', { name: 'A2' });
    await user.click(a2);
    await user.clear(a2);
    await user.type(a2, 'East');
    const b2 = screen.getByRole('textbox', { name: 'B2' });
    await user.click(b2);
    await user.clear(b2);
    await user.type(b2, '1200');
    const a3 = screen.getByRole('textbox', { name: 'A3' });
    await user.click(a3);
    await user.clear(a3);
    await user.type(a3, 'North');
    const b3 = screen.getByRole('textbox', { name: 'B3' });
    await user.click(b3);
    await user.clear(b3);
    await user.type(b3, '800');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').B3).toBe('800'));

    const capture = captureDownloadAnchor();
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const anchor = capture.anchor();
    expect(anchor).toBeTruthy();
    expect(anchor!.download.endsWith('.csv')).toBe(true);
    const text = await lastDownloadText();
    expect(text).toBe('Region,,,\nEast,1200,,\nNorth,800,,\n,,,');
    capture.restore();
  });

  it('escapes commas, quotes and line breaks in exported fields', async () => {
    const user = userEvent.setup();
    render(<App />);

    // line breaks and quoting are preserved end to end via the import flow
    await user.click(await screen.findByRole('button', { name: 'Import CSV' }));
    const fileInput = screen.getByLabelText('CSV file') as HTMLInputElement;
    await user.upload(
      fileInput,
      new File(['a,"b,c","say ""hi""","line1\nline2"\n'], 'escape.csv')
    );
    await user.click(screen.getByRole('button', { name: 'Confirm import' }));
    await screen.findByRole('heading', { name: 'escape' });

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    const text = await lastDownloadText();
    expect(text).toBe('a,"b,c","say ""hi""","line1\nline2"');
  });

  it('exports formula cells as calculated results rather than expressions', async () => {
    const { user } = await openEditor();

    const a2 = screen.getByRole('textbox', { name: 'A2' });
    await user.click(a2);
    await user.clear(a2);
    await user.type(a2, '1200');
    const b2 = screen.getByRole('textbox', { name: 'B2' });
    await user.click(b2);
    await user.clear(b2);
    await user.type(b2, '=1+2');
    const b3 = screen.getByRole('textbox', { name: 'B3' });
    await user.click(b3);
    await user.clear(b3);
    await user.type(b3, '=A2*2');
    const a3 = screen.getByRole('textbox', { name: 'A3' });
    await user.click(a3);
    await user.clear(a3);
    await user.type(a3, '=SUM(A2:B2)');

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    const text = await lastDownloadText();
    expect(text).toContain('1200,3,,');
    expect(text).toContain('1203,2400,,');
    expect(text).not.toContain('=1+2');
    expect(text).not.toContain('=A2*2');
    expect(text).not.toContain('=SUM');
  });

  it('export leaves the active worksheet, grid values and formula bar unchanged and the state persists after refresh', async () => {
    const { user, view } = await openEditor();

    const a2 = screen.getByRole('textbox', { name: 'A2' });
    await user.click(a2);
    await user.clear(a2);
    await user.type(a2, 'East');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').A2).toBe('East'));

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    // before/after: active worksheet, grid values and formula bar unchanged
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Region');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('East');
    expect(screen.getAllByRole('tab')).toHaveLength(2);

    // refresh equivalent: remount at the same entry
    const hash = window.location.hash;
    view.unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Region');
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('East');
    expect(window.location.hash).toBe(hash);
  });

  it('export round-trips an imported CSV, preserving empty fields and UTF-8 text', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Import CSV' }));
    const fileInput = screen.getByLabelText('CSV file') as HTMLInputElement;
    await user.upload(
      fileInput,
      new File(['产品,备注,数量,\n苹果,"a,b",5,\n'], '数据.csv')
    );
    await user.click(screen.getByRole('button', { name: 'Confirm import' }));
    await screen.findByRole('heading', { name: '数据' });

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    const text = await lastDownloadText();
    expect(text).toBe('产品,备注,数量,\n苹果,"a,b",5,');
  });
});
