export interface User {
  username: string;
  email: string;
}

export interface FieldErrors {
  [field: string]: string;
}

export class ApiError extends Error {
  status: number;
  body: { error?: string; fieldErrors?: FieldErrors };

  constructor(status: number, body: { error?: string; fieldErrors?: FieldErrors }) {
    super(body.error || `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  let body: { error?: string; fieldErrors?: FieldErrors } = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  if (!res.ok) {
    throw new ApiError(res.status, body);
  }
  return body as T;
}

export function apiMe(): Promise<{ user: User }> {
  return request<{ user: User }>('/api/me');
}

export function apiRegister(payload: {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  terms: boolean;
}): Promise<{ ok: true; account: { username: string; email: string; emailVerified: boolean } }> {
  return request('/api/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function apiSignIn(identifier: string, password: string): Promise<{ ok: true; user: User }> {
  return request('/api/signin', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  });
}

export function apiSignOut(): Promise<{ ok: true }> {
  return request('/api/signout', { method: 'POST' });
}

export function apiForgotPassword(email: string): Promise<{ ok: true }> {
  return request('/api/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function apiResetPassword(payload: {
  email: string;
  code: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<{ ok: true; message: string }> {
  return request('/api/reset-password', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function apiChangePassword(payload: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<{ ok: true; message: string }> {
  return request('/api/change-password', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface RepositorySummary {
  owner: string;
  name: string;
  description: string;
  visibility: 'public' | 'private';
  updatedAt: string;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

export interface RepositoryDetail extends RepositorySummary {
  defaultBranch: string;
  createdAt: string;
  files: FileEntry[];
}

export interface FileContent {
  owner: string;
  name: string;
  branch: string;
  path: string;
  fileName: string;
  content: string;
}

export function apiSearchRepositories(q: string): Promise<{ results: RepositorySummary[] }> {
  return request(`/api/search?q=${encodeURIComponent(q)}`);
}

export function apiRepositoryDetail(
  owner: string,
  name: string
): Promise<{ repository: RepositoryDetail }> {
  return request(`/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
}

export function apiFileContent(
  owner: string,
  name: string,
  path: string
): Promise<{ file: FileContent }> {
  return request(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/file?path=${encodeURIComponent(path)}`
  );
}

export function apiRepositoryTree(
  owner: string,
  name: string,
  path: string
): Promise<{ entries: FileEntry[] }> {
  return request(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tree?path=${encodeURIComponent(path)}`
  );
}

export interface RepoLabel {
  name: string;
  color: string;
}

export interface RepoMilestone {
  name: string;
}

export interface IssueSummary {
  number: number;
  title: string;
  status: 'open' | 'closed';
  author: string;
  description: string;
  labels: string[];
  assignees: string[];
  milestone: string | null;
  updatedAt: string;
}

export interface IssueComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface IssueActivity {
  id: string;
  type: string;
  author: string;
  createdAt: string;
  label: string | null;
  commentId: string | null;
  milestone?: string | null;
  value?: string | null;
}

export interface IssuePermissions {
  manageMetadata: boolean;
  canEditContent: boolean;
}

export interface IssueDetail extends IssueSummary {
  createdAt: string;
  comments: IssueComment[];
  activity: IssueActivity[];
  permissions: IssuePermissions;
}

export function apiRepositoryIssues(
  owner: string,
  name: string
): Promise<{
  repository: RepositoryDetail;
  issues: IssueSummary[];
  labels: RepoLabel[];
  milestones: RepoMilestone[];
}> {
  return request(`/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues`);
}

export function apiIssueDetail(
  owner: string,
  name: string,
  number: number
): Promise<{
  repository: RepositoryDetail;
  issue: IssueDetail;
  labels: RepoLabel[];
  milestones: RepoMilestone[];
}> {
  return request(
    `/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}`
  );
}

export function apiUpdateIssueLabels(
  owner: string,
  name: string,
  number: number,
  labels: string[]
): Promise<{ issue: IssueDetail }> {
  return request(`/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/labels`, {
    method: 'PUT',
    body: JSON.stringify({ labels }),
  });
}

export function apiUpdateIssue(
  owner: string,
  name: string,
  number: number,
  patch: { title?: string; description?: string }
): Promise<{ issue: IssueDetail }> {
  return request(`/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function apiUpdateIssueMilestone(
  owner: string,
  name: string,
  number: number,
  milestone: string | null
): Promise<{ issue: IssueDetail }> {
  return request(`/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/milestone`, {
    method: 'PUT',
    body: JSON.stringify({ milestone }),
  });
}

export function apiUpdateIssueStatus(
  owner: string,
  name: string,
  number: number,
  status: 'open' | 'closed'
): Promise<{ issue: IssueDetail }> {
  return request(`/api/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}
