import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createMockServer, seedWorkbook, cellsOf, type MockServer } from './test/mockServer';

function setHash(hash: string) {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

describe('REQ-1-1-1 View and Open a Workbook', () => {
  let server: MockServer;

  beforeEach(() => {
    server = createMockServer([seedWorkbook()]);
    vi.stubGlobal('fetch', server.fetch);
    window.location.hash = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('home page lists the seeded workbook with a name link and Last updated text', async () => {
    render(<App />);

    const link = await screen.findByRole('link', { name: 'Q3 Sales' });
    expect(link).toHaveAttribute('href', '#/workbook/q3-sales');

    const card = link.closest('article');
    expect(card).toBeTruthy();
    expect(card).toHaveTextContent('Last updated: ');
  });

  it('clicking the workbook link opens the editor with name, Last updated, Sheet1 tab and grid', async () => {
    const user = userEvent.setup();
    render(<App />);

    const link = await screen.findByRole('link', { name: 'Q3 Sales' });
    await user.click(link);

    expect(await screen.findByRole('heading', { name: 'Q3 Sales' })).toBeTruthy();
    expect(screen.getByText(/Last updated:/)).toBeTruthy();

    const tab = screen.getByRole('tab', { name: 'Sheet1' });
    expect(tab).toHaveAttribute('aria-selected', 'true');

    const grid = screen.getByRole('grid', { name: 'Worksheet grid' });
    expect(grid).toHaveAttribute('aria-multiselectable', 'true');

    const a1 = screen.getByRole('gridcell', { name: 'A1' });
    expect(a1).toHaveAttribute('aria-selected', 'true');
    expect(a1).toHaveTextContent('Region');
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Region');

    expect(screen.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('Region');
  });

  it('the editor entry is directly accessible and restores the same workbook on refresh', async () => {
    const user = userEvent.setup();
    setHash('#/workbook/q3-sales');
    const first = render(<App />);

    expect(await screen.findByRole('heading', { name: 'Q3 Sales' })).toBeTruthy();
    const a2 = screen.getByRole('textbox', { name: 'A2' });
    await user.clear(a2);
    await user.type(a2, 'East');
    await waitFor(() => expect(cellsOf(server, 'q3-sales').A2).toBe('East'));

    first.unmount();

    const second = render(<App />);
    expect(await screen.findByRole('heading', { name: 'Q3 Sales' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'A2' })).toHaveValue('East');
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Region');
    second.unmount();
  });

  it('data from another workbook does not appear in the current grid', async () => {
    const other = seedWorkbook();
    other.id = 'other';
    other.name = 'Other Book';
    other.sheets[0].cells.A1 = 'Different';
    server.workbooks.set('other', other);

    setHash('#/workbook/q3-sales');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Q3 Sales' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Region');
    expect(screen.getByRole('grid', { name: 'Worksheet grid' })).not.toHaveTextContent(
      'Different'
    );
  });

  it('selecting a cell updates the formula bar and aria-selected states; dragging selects a region', async () => {
    setHash('#/workbook/q3-sales');
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });

    const a1 = screen.getByRole('gridcell', { name: 'A1' });
    expect(a1).toHaveAttribute('aria-selected', 'true');

    fireEvent.mouseDown(a1);
    const b2 = screen.getByRole('gridcell', { name: 'B2' });
    fireEvent.mouseEnter(b2);
    fireEvent.mouseUp(window);

    expect(a1).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('gridcell', { name: 'A2' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('gridcell', { name: 'B1' })).toHaveAttribute('aria-selected', 'true');
    expect(b2).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('gridcell', { name: 'C1' })).toHaveAttribute('aria-selected', 'false');

    fireEvent.mouseDown(screen.getByRole('gridcell', { name: 'C3' }));
    fireEvent.mouseUp(window);
    expect(screen.getByRole('gridcell', { name: 'C3' })).toHaveAttribute('aria-selected', 'true');
    expect(a1).toHaveAttribute('aria-selected', 'false');
  });

  it('failed saves show an error beside the control and do not create a partial record', async () => {
    const user = userEvent.setup();
    setHash('#/workbook/q3-sales');
    render(<App />);
    await screen.findByRole('heading', { name: 'Q3 Sales' });

    const c2 = screen.getByRole('textbox', { name: 'C2' });
    await user.click(c2);
    // The click itself persists the selection; fail the cell-edit save that
    // follows so the uncommitted value produces no partial record.
    server.failNextSave = true;
    await user.type(c2, 'E');

    expect(await screen.findByRole('alert')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'C2' })).toHaveValue(''));
    expect(cellsOf(server, 'q3-sales').C2).toBeUndefined();
    expect(cellsOf(server, 'q3-sales').A1).toBe('Region');
  });

  it('unknown workbook ids show a recoverable error state', async () => {
    setHash('#/workbook/does-not-exist');
    render(<App />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

describe('REQ-1-2-1 Create a Blank Workbook', () => {
  let server: MockServer;

  beforeEach(() => {
    server = createMockServer([seedWorkbook()]);
    vi.stubGlobal('fetch', server.fetch);
    window.location.hash = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('home page provides a New blank workbook button that opens the creation page with a Create submit button', async () => {
    const user = userEvent.setup();
    render(<App />);

    const button = await screen.findByRole('button', { name: 'New blank workbook' });
    await user.click(button);

    expect(screen.getByRole('heading', { name: 'New workbook' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Workbook name' })).toHaveValue(
      'Untitled workbook'
    );
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
  });

  it('creating a workbook opens the editor with only Sheet1 active and A1 selected', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'New blank workbook' }));
    const input = screen.getByRole('textbox', { name: 'Workbook name' });
    await user.clear(input);
    await user.type(input, 'My New Book');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('heading', { name: 'My New Book' })).toBeTruthy();
    expect(screen.getByRole('grid', { name: 'Worksheet grid' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByRole('gridcell', { name: 'A1' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('');

    const created = Array.from(server.workbooks.values()).find(
      (wb) => wb.name === 'My New Book'
    );
    expect(created).toBeTruthy();
    expect(created?.sheets).toHaveLength(1);
    expect(created?.sheets[0].name).toBe('Sheet1');
    expect(created?.sheets[0].cells).toEqual({});
  });

  it('refresh reopens the same created workbook state', async () => {
    const user = userEvent.setup();
    const first = render(<App />);

    await user.click(await screen.findByRole('button', { name: 'New blank workbook' }));
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByRole('heading', { name: 'Untitled workbook' });
    const created = Array.from(server.workbooks.values()).find(
      (wb) => wb.name === 'Untitled workbook'
    );
    expect(created).toBeTruthy();

    first.unmount();
    setHash(`#/workbook/${created!.id}`);
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Untitled workbook' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('');
  });

  it('returning to the home page shows the created record and reopening preserves state', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'New blank workbook' }));
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByRole('heading', { name: 'Untitled workbook' });

    await user.click(screen.getByRole('link', { name: 'Back to workbooks' }));
    const link = await screen.findByRole('link', { name: 'Untitled workbook' });
    await user.click(link);

    expect(await screen.findByRole('heading', { name: 'Untitled workbook' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('gridcell', { name: 'A1' })).toHaveAttribute('aria-selected', 'true');
  });

  it('creation failure shows an error, stays retryable and creates no record', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'New blank workbook' }));
    server.failNextCreate = true;
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Create failed');
    expect(screen.getByRole('textbox', { name: 'Workbook name' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
    expect(Array.from(server.workbooks.values()).map((wb) => wb.name)).toEqual(['Q3 Sales']);

    // retry succeeds and enters the editor
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('heading', { name: 'Untitled workbook' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toHaveAttribute('aria-selected', 'true');
  });

  it('home page after a failed creation does not show an incomplete workbook record', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'New blank workbook' }));
    server.failNextCreate = true;
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByRole('alert');

    await user.click(screen.getByRole('link', { name: 'Cancel' }));
    expect(await screen.findByRole('link', { name: 'Q3 Sales' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Untitled workbook' })).toBeNull();
  });
});

describe('REQ-1-2-2 Rename a Workbook', () => {
  let server: MockServer;

  beforeEach(() => {
    server = createMockServer([seedWorkbook()]);
    vi.stubGlobal('fetch', server.fetch);
    window.location.hash = '';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a Rename workbook button next to the title; clicking opens a prefilled Workbook name input and Save button', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('link', { name: 'Q3 Sales' }));
    await screen.findByRole('heading', { name: 'Q3 Sales' });

    const button = screen.getByRole('button', { name: 'Rename workbook' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    const input = screen.getByRole('textbox', { name: 'Workbook name' });
    expect(input).toHaveValue('Q3 Sales');
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('successful rename updates the editor title and home-page link and persists after reopening', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('link', { name: 'Q3 Sales' }));
    await screen.findByRole('heading', { name: 'Q3 Sales' });

    await user.click(screen.getByRole('button', { name: 'Rename workbook' }));
    const input = screen.getByRole('textbox', { name: 'Workbook name' });
    await user.clear(input);
    await user.type(input, 'Q4 Sales');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(server.workbooks.get('q3-sales')?.name).toBe('Q4 Sales'));
    expect(screen.getByRole('heading', { name: 'Q4 Sales' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Workbook name' })).toBeNull();
    expect(cellsOf(server, 'q3-sales').A1).toBe('Region');
    expect(cellsOf(server, 'q3-sales').A2).toBe('East');

    // home page link displays the new name
    await user.click(screen.getByRole('link', { name: 'Back to workbooks' }));
    const homeLink = await screen.findByRole('link', { name: 'Q4 Sales' });
    expect(homeLink).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Q3 Sales' })).toBeNull();

    // reopening shows the most recently saved name and the seeded data
    await user.click(homeLink);
    expect(await screen.findByRole('heading', { name: 'Q4 Sales' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Sheet1' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: 'A1' })).toHaveValue('Region');
  });

  it('rejects an empty name with Workbook name cannot be empty and keeps the original state', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('link', { name: 'Q3 Sales' }));
    await screen.findByRole('heading', { name: 'Q3 Sales' });

    await user.click(screen.getByRole('button', { name: 'Rename workbook' }));
    const input = screen.getByRole('textbox', { name: 'Workbook name' });
    await user.clear(input);
    await user.type(input, '   ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Workbook name cannot be empty');
    expect(screen.getByRole('heading', { name: 'Q3 Sales' })).toBeTruthy();
    expect(server.workbooks.get('q3-sales')?.name).toBe('Q3 Sales');
    expect(cellsOf(server, 'q3-sales').A1).toBe('Region');

    // refresh shows the original name
    await user.click(screen.getByRole('link', { name: 'Back to workbooks' }));
    expect(await screen.findByRole('link', { name: 'Q3 Sales' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Q4 Sales' })).toBeNull();
  });

  it('when saving fails an error is shown and the original name remains displayed', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('link', { name: 'Q3 Sales' }));
    await screen.findByRole('heading', { name: 'Q3 Sales' });

    await user.click(screen.getByRole('button', { name: 'Rename workbook' }));
    const input = screen.getByRole('textbox', { name: 'Workbook name' });
    await user.clear(input);
    await user.type(input, 'Q4 Sales');

    server.failNextSave = true;
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
    expect(screen.getByRole('heading', { name: 'Q3 Sales' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Workbook name' })).toHaveValue('Q3 Sales');
    expect(server.workbooks.get('q3-sales')?.name).toBe('Q3 Sales');
    expect(cellsOf(server, 'q3-sales').A1).toBe('Region');

    // a later successful save applies the new name
    await user.clear(input);
    await user.type(input, 'Q4 Sales');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(server.workbooks.get('q3-sales')?.name).toBe('Q4 Sales'));
    expect(screen.getByRole('heading', { name: 'Q4 Sales' })).toBeTruthy();
  });
});
