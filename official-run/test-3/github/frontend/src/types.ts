export interface SessionUser {
  id: string;
  username: string;
  email: string;
}

export interface FieldErrors {
  [field: string]: string | undefined;
}

export interface SessionResponse {
  user: SessionUser | null;
}

export interface SignInResponse {
  ok: true;
  user: SessionUser;
}

export interface RegisterResponse {
  ok: true;
}

export interface RecoverRequestResponse {
  ok: true;
  code: string;
}

export interface RecoverResetResponse {
  ok: true;
}

export interface ChangePasswordResponse {
  ok: true;
}
