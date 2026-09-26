import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { navigate } from '../router';
import { mockFetch } from './mockFetch';

const GUIDE_CONTENT = 'Step by step instructions for the Acme platform.';

const acmeDocsAdmin = {
  owner: 'acme-demo',
  ownerType: 'organization',
  name: 'acme-docs',
  description: 'Documentation for the Acme platform',
  visibility: 'public',
  defaultBranch: 'main',
  updatedAt: '2026-01-10T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  role: 'admin',
};

const acmeDocsRead = { ...acmeDocsAdmin, role: 'read' };

const SEARCH_TS_CONTENT =
  '// Search flow\n//\n// This file documents the search flow used by the Acme platform.\nexport const searchFlow = true;\n';

const rootContents = () => ({
  status: 200,
  body: {
    ok: true,
    branch: { name: 'main', headCommitId: 'c2' },
    files: [
      { path: 'README.md', content: '# acme-docs\n' },
      { path: 'src/search.ts', content: SEARCH_TS_CONTENT },
    ],
    entries: [
      { name: 'src', type: 'directory', path: 'src' },
      { name: 'README.md', type: 'file', path: 'README.md' },
    ],
  },
});

const acmeDocsCommits = () => ({
  status: 200,
  body: {
    ok: true,
    commits: [
      { id: 'c4', message: 'Add guide', author: 'alice-dev', createdAt: '2026-01-06T00:00:00.000Z' },
      { id: 'c2', message: 'Document search flow', author: 'alice-dev', createdAt: '2026-01-05T00:00:00.000Z' },
      { id: 'c1', message: 'Initial commit', author: 'alice-dev', createdAt: '2026-01-01T00:00:00.000Z' },
    ],
  },
});

const branches = () => ({
  status: 200,
  body: {
    ok: true,
    defaultBranch: 'main',
    canCreate: true,
    branches: [
      { name: 'main', headCommitId: 'c2' },
      { name: 'feature-search', headCommitId: 'c3' },
    ],
  },
});

// Mutable server-side snapshot so a successful write is visible to the
// following file-page reads (persisted behavior).
const savedFiles: Record<string, string> = {
  'README.md': '# acme-docs\n',
  'src/search.ts': SEARCH_TS_CONTENT,
};

const blobFor = (filePath: string, role: string) => () => ({
  status: 200,
  body: {
    ok: true,
    branch: 'main',
    file: { path: filePath, content: savedFiles[filePath] ?? '' },
    commit: {
      id: 'c4',
      message: 'Latest commit',
      author: 'alice-dev',
      createdAt: '2026-01-06T00:00:00.000Z',
    },
    role,
  },
});

interface EditorOptions {
  role: 'admin' | 'read';
  createResponse?: { status: number; body: unknown };
}

function mockEditorRoutes(options: EditorOptions) {
  const overview = options.role === 'admin' ? acmeDocsAdmin : acmeDocsRead;
  return mockFetch({
    '/api/auth/session': () => ({
      status: 200,
      body: { authenticated: true, username: 'alice-dev', email: 'alice.dev@example.test' },
    }),
    '/api/repositories/acme-demo/acme-docs': () => ({
      status: 200,
      body: { ok: true, repository: overview },
    }),
    '/api/repositories/acme-demo/acme-docs/contents': rootContents,
    '/api/repositories/acme-demo/acme-docs/commits': acmeDocsCommits,
    '/api/repositories/acme-demo/acme-docs/branches': branches,
    'POST /api/repositories/acme-demo/acme-docs/contents': (init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (options.createResponse) {
        return options.createResponse;
      }
      // The server echoes the submitted path/content so the editor navigates
      // to the saved view of exactly the written file (persisted behavior).
      savedFiles[body.path] = body.content ?? '';
      return {
        status: 201,
        body: {
          ok: true,
          branch: { name: body.branch, headCommitId: 'c4' },
          commit: {
            id: 'c4',
            message: body.message,
            author: 'alice-dev',
            createdAt: '2026-01-06T00:00:00.000Z',
          },
          file: { path: body.path, content: body.content },
        },
      };
    },
    '/api/repositories/acme-demo/acme-docs/contents/main/docs/guide.md': blobFor('docs/guide.md', options.role),
    '/api/repositories/acme-demo/acme-docs/contents/main/src/search.ts': blobFor('src/search.ts', options.role),
    '/api/repositories/acme-demo/acme-docs/contents/main/README.md': blobFor('README.md', options.role),
    '/api/repositories/acme-demo/acme-docs/tree/main': () => ({
      status: 200,
      body: {
        ok: true,
        branch: { name: 'main', headCommitId: 'c2' },
        path: '',
        entries: [
          { name: 'src', type: 'directory', path: 'src' },
          { name: 'README.md', type: 'file', path: 'README.md' },
        ],
        role: options.role,
      },
    }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
  delete savedFiles['docs/guide.md'];
  savedFiles['src/search.ts'] = SEARCH_TS_CONTENT;
});

beforeEach(() => {
  window.location.hash = '';
});

describe('REQ-4-4 Manage Repository Files Through the Web Interface (write user)', () => {
  it('scenario 1: Add file -> Create new file opens the editor; submitting creates the commit and opens the saved view', async () => {
    const fetchSpy = mockEditorRoutes({ role: 'admin' });
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);

    await screen.findByRole('heading', { name: 'acme-demo/acme-docs' });

    // The unique Add file button opens the Create new file menuitem.
    const addFileButton = screen.getByRole('button', { name: 'Add file' });
    expect(screen.getAllByRole('button', { name: 'Add file' })).toHaveLength(1);
    expect(addFileButton).toHaveAttribute('aria-haspopup', 'menu');
    await user.click(addFileButton);
    const menuitem = screen.getByRole('menuitem', { name: 'Create new file' });
    await user.click(menuitem);

    // The editor shows the repository/branch context, the required fields and
    // the initially empty Commit message field.
    await screen.findByRole('heading', { name: 'Create new file' });
    expect(window.location.hash).toBe('#/repositories/acme-demo/acme-docs/new/main');
    const fileNameInput = screen.getByLabelText('File name');
    const contentsBox = screen.getByRole('textbox', { name: 'File contents' });
    const commitMessageInput = screen.getByLabelText('Commit message');
    expect(commitMessageInput).toHaveValue('');
    expect(fileNameInput).toHaveValue('');
    const commitButton = screen.getByRole('button', { name: 'Commit changes' });

    await user.type(fileNameInput, 'docs/guide.md');
    await user.type(contentsBox, GUIDE_CONTENT);
    await user.type(commitMessageInput, 'Add guide');
    await user.click(commitButton);
    // One submission stores the path/content, message, author, parent commit
    // and target branch as one record and moves the branch head to it.
    const writeCalls = fetchSpy.mock.calls.filter(
      ([input, init]) =>
        String(input).includes('/contents') && init?.method === 'POST'
    );
    expect(writeCalls.length).toBe(1);
    const sent = JSON.parse(String(writeCalls[0][1]?.body));
    expect(sent).toEqual({
      branch: 'main',
      path: 'docs/guide.md',
      content: GUIDE_CONTENT,
      message: 'Add guide',
    });

    // The saved view opens immediately and displays the exact content.
    await waitFor(() =>
      expect(window.location.hash).toBe(
        '#/repositories/acme-demo/acme-docs/blob/main/docs/guide.md'
      )
    );
    expect(await screen.findByText(GUIDE_CONTENT)).toBeInTheDocument();
    expect(document.querySelector('.file-content')?.textContent).toBe(GUIDE_CONTENT);

    // Its Commits link opens the history displaying the exact submitted
    // message.
    const commitsLink = screen.getByRole('link', { name: 'Commits' });
    expect(commitsLink).toHaveAttribute(
      'href',
      '#/repositories/acme-demo/acme-docs/commits/main/docs/guide.md'
    );
    await user.click(commitsLink);
    expect(await screen.findByRole('heading', { name: 'Commits' })).toBeInTheDocument();
    expect(screen.getByText('Add guide')).toBeInTheDocument();
  });

  it('an invalid path with an empty commit message reports both reasons and changes nothing', async () => {
    const fetchSpy = mockEditorRoutes({
      role: 'admin',
      createResponse: {
        status: 400,
        body: {
          ok: false,
          errors: { path: 'Invalid file path', message: 'Commit message is required' },
        },
      },
    });
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);

    await screen.findByRole('heading', { name: 'acme-demo/acme-docs' });
    await user.click(screen.getByRole('button', { name: 'Add file' }));
    await user.click(screen.getByRole('menuitem', { name: 'Create new file' }));

    await screen.findByRole('heading', { name: 'Create new file' });
    await user.type(screen.getByLabelText('File name'), '../invalid.md');
    await user.type(
      screen.getByRole('textbox', { name: 'File contents' }),
      'must not be saved'
    );
    // No commit message is entered.
    await user.click(screen.getByRole('button', { name: 'Commit changes' }));

    expect(await screen.findByText('Invalid file path')).toBeInTheDocument();
    expect(screen.getByText('Commit message is required')).toBeInTheDocument();
    // Still on the editor; no navigation happened.
    expect(window.location.hash).toBe('#/repositories/acme-demo/acme-docs/new/main');
    const writeCalls = fetchSpy.mock.calls.filter(
      ([input, init]) =>
        String(input).includes('/contents') && init?.method === 'POST'
    );
    expect(writeCalls.length).toBe(1);
    const sent = JSON.parse(String(writeCalls[0][1]?.body));
    expect(sent.path).toBe('../invalid.md');
    expect(sent.message).toBe('');
    // The example content is ordinary text, not the rejection reason: the
    // payload carried it but the server rejected on path/message.
    expect(sent.content).toBe('must not be saved');
  });

  it('an Edit entry on the file page opens the editor pre-filled and submits an update commit', async () => {
    const fetchSpy = mockEditorRoutes({ role: 'admin' });
    const user = userEvent.setup();
    navigate('#/repositories/acme-demo/acme-docs/blob/main/src/search.ts');
    render(<App />);

    await screen.findByText(/export const searchFlow = true;/);
    const editButton = screen.getByRole('button', { name: 'Edit' });
    await user.click(editButton);

    expect(await screen.findByRole('heading', { name: 'Edit file' })).toBeInTheDocument();
    expect(window.location.hash).toBe(
      '#/repositories/acme-demo/acme-docs/edit/main/src/search.ts'
    );
    const fileNameInput = screen.getByLabelText('File name');
    expect(fileNameInput).toHaveValue('src/search.ts');
    expect(screen.getByRole('textbox', { name: 'File contents' })).toHaveValue(
      SEARCH_TS_CONTENT
    );
    const commitMessageInput = screen.getByLabelText('Commit message');
    expect(commitMessageInput).toHaveValue('');

    const updatedContent = '// Search flow updated in the editor.';
    await user.clear(screen.getByRole('textbox', { name: 'File contents' }));
    await user.type(
      screen.getByRole('textbox', { name: 'File contents' }),
      updatedContent
    );
    await user.type(commitMessageInput, 'Update search flow');
    await user.click(screen.getByRole('button', { name: 'Commit changes' }));

    const writeCalls = fetchSpy.mock.calls.filter(
      ([input, init]) =>
        String(input).includes('/contents') && init?.method === 'POST'
    );
    const sent = JSON.parse(String(writeCalls[0][1]?.body));
    expect(sent).toEqual({
      branch: 'main',
      path: 'src/search.ts',
      content: updatedContent,
      message: 'Update search flow',
    });
    await waitFor(() =>
      expect(window.location.hash).toBe(
        '#/repositories/acme-demo/acme-docs/blob/main/src/search.ts'
      )
    );
  });
});

describe('REQ-4-4 Manage Repository Files Through the Web Interface (read-only)', () => {
  it('a Read account only views: no Add file button and direct editor URLs are denied', async () => {
    mockEditorRoutes({ role: 'read' });
    navigate('#/repositories/acme-demo/acme-docs');
    render(<App />);

    await screen.findByRole('heading', { name: 'acme-demo/acme-docs' });
    expect(screen.queryByRole('button', { name: 'Add file' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Create new file' })).not.toBeInTheDocument();
    // The file page carries no Edit entry either.
    navigate('#/repositories/acme-demo/acme-docs/blob/main/README.md');
    expect(await screen.findByText('# acme-docs')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();

    // Directly opening the editor is denied by the page's role gate (and the
    // server rejects unauthorized submissions too).
    navigate('#/repositories/acme-demo/acme-docs/new/main');
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(screen.queryByLabelText('File name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Commit changes' })).not.toBeInTheDocument();
  });
});
