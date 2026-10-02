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
  /** Owner namespace message of the repository creation and fork forms. */
  owner?: string;
  /** Branch name message of the branch creation and default-branch forms. */
  branch?: string;
  /** File path message of the new-file editor. */
  path?: string;
  /** Commit message message of the new-file editor. */
  message?: string;
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
