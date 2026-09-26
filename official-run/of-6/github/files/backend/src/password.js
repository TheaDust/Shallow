'use strict';

const crypto = require('crypto');

/**
 * Deterministic salted hash for a password. Passwords are never stored or
 * returned in plain text anywhere in the system.
 */
function hashPassword(password, salt) {
  const hash = crypto.createHash('sha256');
  hash.update(`${salt}:${password}`);
  return hash.digest('hex');
}

function newSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function verifyPassword(password, salt, expectedHash) {
  const actual = hashPassword(String(password), salt);
  const expected = Buffer.from(String(expectedHash), 'utf8');
  const received = Buffer.from(actual, 'utf8');
  if (expected.length !== received.length) {
    return false;
  }
  return crypto.timingSafeEqual(expected, received);
}

module.exports = { hashPassword, newSalt, verifyPassword };
