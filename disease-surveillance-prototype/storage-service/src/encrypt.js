'use strict';

/**
 * encrypt.js
 *
 * AES-256-GCM field-level encryption helpers for the storage service.
 *
 * Key derivation
 * ──────────────
 * deriveKey(keyStr) runs the raw STORAGE_ENC_KEY string through SHA-256 to
 * produce a stable 32-byte Buffer regardless of the original string length.
 * The SHA-256 step means any non-empty env string works safely.
 *
 * Encrypted format
 * ────────────────
 * encryptField returns a compact JSON string:
 *   { "iv": "<base64>", "authTag": "<base64>", "ciphertext": "<base64>" }
 *
 * The iv is 12 random bytes (96-bit GCM standard).
 * The auth tag is 16 bytes (128-bit, GCM default).
 *
 * Security note: a fresh IV is generated for every encrypt call so that
 * identical plaintexts produce different ciphertexts (IND-CPA).
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES  = 12;   // 96-bit nonce – GCM recommended length

// ─── Key derivation ───────────────────────────────────────────────────────────

/**
 * Derive a 32-byte AES-256 key from an arbitrary env-var string via SHA-256.
 * @param {string} keyStr  - value of STORAGE_ENC_KEY
 * @returns {Buffer}       - 32-byte key
 */
function deriveKey(keyStr) {
  if (!keyStr) {
    throw new Error('STORAGE_ENC_KEY environment variable is required but not set');
  }
  return crypto.createHash('sha256').update(keyStr, 'utf8').digest();
}

// ─── Encrypt / decrypt ────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext string with AES-256-GCM.
 *
 * @param {string} plaintext - UTF-8 string to encrypt
 * @param {Buffer} key       - 32-byte key (from deriveKey)
 * @returns {string}         - JSON string { iv, authTag, ciphertext } (base64 values)
 */
function encryptField(plaintext, key) {
  const iv     = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();   // always 16 bytes with GCM default

  return JSON.stringify({
    iv:         iv.toString('base64'),
    authTag:    authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  });
}

/**
 * Decrypt a value produced by encryptField.
 *
 * @param {string} encryptedJson - JSON string { iv, authTag, ciphertext }
 * @param {Buffer} key           - 32-byte key (from deriveKey)
 * @returns {string}             - original UTF-8 plaintext
 */
function decryptField(encryptedJson, key) {
  const { iv, authTag, ciphertext } = JSON.parse(encryptedJson);

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = { deriveKey, encryptField, decryptField };

