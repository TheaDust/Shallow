export interface Account {
  id: string;
  username: string;
  email: string;
  verified: boolean;
  status: string;
}

export interface FieldErrors {
  username?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  agreeToTerms?: string;
  code?: string;
  newPassword?: string;
  currentPassword?: string;
  name?: string;
  displayName?: string;
  identifier?: string;
  parentTeam?: string;
  teamName?: string;
  role?: string;
}

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  agreeToTerms: boolean;
}

export interface PasswordResetInput {
  email: string;
  code: string;
  newPassword: string;
  confirmPassword: string;
}

export interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export type PasswordChangeErrors = FieldErrors;
