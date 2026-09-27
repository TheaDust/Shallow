import type {
  ChangePasswordResponse,
  FieldErrors,
  RecoverRequestResponse,
  RecoverResetResponse,
  RegisterResponse,
  SessionResponse,
  SignInResponse,
} from './types';

export class ApiError extends Error {
  status: number;
  fieldErrors: FieldErrors;

  constructor(status: number, message: string, fieldErrors: FieldErrors = {}) {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

interface ApiBody {
  message?: string;
  fieldErrors?: FieldErrors;
}

// Same-origin relative calls to the backend (no hardcoded host/port).
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch {
    throw new ApiError(0, 'Network error');
  }

  let body: ApiBody | null = null;
  try {
    body = (await res.json()) as ApiBody;
  } catch {
    body = null;
  }

  if (!res.ok) {
    throw new ApiError(res.status, body?.message || 'Request failed', body?.fieldErrors || {});
  }
  return body as T;
}

export function getSession(): Promise<SessionResponse> {
  return apiFetch<SessionResponse>('/api/session');
}

export function signIn(identifier: string, password: string): Promise<SignInResponse> {
  return apiFetch<SignInResponse>('/api/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  });
}

export function register(payload: {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  agreeToTerms: boolean;
}): Promise<RegisterResponse> {
  return apiFetch<RegisterResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function signOut(): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>('/api/auth/signout', { method: 'POST' });
}

export function recoverRequest(email: string): Promise<RecoverRequestResponse> {
  return apiFetch<RecoverRequestResponse>('/api/auth/recover-request', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function recoverReset(payload: {
  email: string;
  code: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<RecoverResetResponse> {
  return apiFetch<RecoverResetResponse>('/api/auth/recover-reset', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function changePassword(payload: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<ChangePasswordResponse> {
  return apiFetch<ChangePasswordResponse>('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
