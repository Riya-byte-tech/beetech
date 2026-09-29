/**
 * Auth primitives, deliberately built on Node's built-in `crypto` module only
 * (no bcrypt, no jsonwebtoken) - consistent with this project's running theme
 * of avoiding native/third-party dependencies where a small amount of code
 * does the job just as correctly (see: node:sqlite instead of better-sqlite3).
 *
 * Password hashing: scrypt with a random salt per user, stored as a single
 * self-describing string so the algorithm/params could change later without
 * breaking existing hashes: "scrypt:<N>:<salt-hex>:<hash-hex>".
 *
 * Tokens: a minimal JWT-shaped token (header.payload.signature, HMAC-SHA256,
 * base64url-encoded) - not a full JWT library, but the same three-part
 * structure and the same security property (server-signed, tamper-evident,
 * unforgeable without the secret). Good enough for a single-server session
 * token; a real multi-service deployment would reach for a vetted library.
 */

const crypto = require('crypto');

const SCRYPT_N = 16384; // scrypt cost parameter (CPU/memory cost factor)
const KEY_LEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N }).toString('hex');
  return `scrypt:${SCRYPT_N}:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [scheme, nStr, salt, hashHex] = (stored || '').split(':');
  if (scheme !== 'scrypt') return false;
  const n = parseInt(nStr, 10);
  const computed = crypto.scryptSync(password, salt, KEY_LEN, { N: n });
  const stored_ = Buffer.from(hashHex, 'hex');
  if (computed.length !== stored_.length) return false;
  return crypto.timingSafeEqual(computed, stored_);
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set - check your .env file (see .env.example)');
  }
  return secret;
}

/** payload should be plain, JSON-serializable data (no functions/dates). */
function signToken(payload, expiresInSeconds = 60 * 60 * 24 * 7) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + expiresInSeconds };

  const headerPart = base64url(JSON.stringify(header));
  const bodyPart = base64url(JSON.stringify(body));
  const signature = crypto
    .createHmac('sha256', getSecret())
    .update(`${headerPart}.${bodyPart}`)
    .digest('base64url');

  return `${headerPart}.${bodyPart}.${signature}`;
}

class TokenError extends Error {}

/** Returns the decoded payload, or throws TokenError if invalid/expired. */
function verifyToken(token) {
  if (!token || typeof token !== 'string') throw new TokenError('Missing token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new TokenError('Malformed token');
  const [headerPart, bodyPart, signature] = parts;

  const expectedSignature = crypto
    .createHmac('sha256', getSecret())
    .update(`${headerPart}.${bodyPart}`)
    .digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new TokenError('Invalid signature');
  }

  const payload = JSON.parse(Buffer.from(bodyPart, 'base64url').toString('utf-8'));
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
    throw new TokenError('Token expired');
  }
  return payload;
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, TokenError };
