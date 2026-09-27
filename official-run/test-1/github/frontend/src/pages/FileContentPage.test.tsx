import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FileContentPage from './FileContentPage';

function stubFile(status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/repositories/alice-dev/acme-docs/file?')) {
        if (status === 200) {
          return new Response(
            JSON.stringify({
              file: {
                owner: 'alice-dev',
                name: 'acme-docs',
                branch: 'main',
                path: 'README.md',
                fileName: 'README.md',
                content: '# Acme Docs\n\nWelcome to the Acme documentation repository.',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FileContentPage', () => {
  it('renders the file name and complete content', async () => {
    stubFile();
    render(
      <FileContentPage owner="alice-dev" name="acme-docs" branch="main" path="README.md" />
    );

    await screen.findByRole('heading', { name: 'README.md' });
    const pre = screen.getByText(
      (_content, element) =>
        element?.tagName === 'PRE' &&
        element.textContent === '# Acme Docs\n\nWelcome to the Acme documentation repository.'
    );
    expect(pre).toBeInTheDocument();
    expect(screen.getByText('alice-dev/acme-docs', { selector: 'a' })).toBeInTheDocument();
  });

  it('shows File not found when the file is denied or missing', async () => {
    stubFile(404);
    render(
      <FileContentPage owner="alice-dev" name="acme-docs" branch="main" path="README.md" />
    );
    await screen.findByRole('heading', { name: 'File not found' });
  });
});
