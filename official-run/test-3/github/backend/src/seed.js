import { createStore } from './store.js';

// Shared seed data (REQ-1): account alice-dev / alice.dev@example.test /
// Valid-password-123!. Provisioned once into an empty store; later user
// modifications are preserved because the seed only applies on first creation.
export const SEED_ACCOUNT = {
  username: 'alice-dev',
  email: 'alice.dev@example.test',
  password: 'Valid-password-123!',
};

export function provisionSeed(store) {
  if (store.isSeeded()) return;
  const existing = store.findAccountByUsername(SEED_ACCOUNT.username);
  if (!existing) {
    store.createAccount({
      username: SEED_ACCOUNT.username,
      email: SEED_ACCOUNT.email,
      password: SEED_ACCOUNT.password,
    });
  }
}

export { createStore };
