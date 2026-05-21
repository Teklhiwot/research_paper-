/**
 * utils/crypto.js
 *
 * Cryptographic primitives for the disease-surveillance edge client.
 *
 * Signing    : Ed25519 via tweetnacl – asymmetric, non-repudiable.
 * Encryption : AES-256-GCM via @noble/ciphers – authenticated encryption.
 * Randomness : react-native-get-random-values patches globalThis.crypto so that
 *              tweetnacl and @noble/ciphers can call getRandomValues safely on
 *              all RN/Hermes versions. This import MUST stay first.
 *
 * Key persistence:
 *   The Ed25519 keypair is generated once per device and stored in AsyncStorage
 *   under KEYPAIR_STORAGE_KEY. In a production deployment, replace AsyncStorage
 *   with expo-secure-store to keep the private key in the OS secure enclave.
 *
 * Exports:
 *   generateKeyPair()                            → { publicKey, secretKey } (Uint8Array)
 *   loadOrCreateKeyPair()                        → Promise<{ publicKey, secretKey }>
 *   signReport(reportObj, secretKey)             → base64 signature string
 *   encryptReport(reportObj, symmetricKey)       → { ciphertext, iv, tag } (all base64)
 *   buildGatewayPayload(report, secretKey,
 *                       publicKey, symmetricKey) → { payload, signature, publicKey, eventId }
 *   hexToBytes(hex, label)                       → Uint8Array  (re-exported for reportService)
 */

// ⚠️  Must be the very first import – patches globalThis.crypto.getRandomValues
import 'react-native-get-random-values';

import nacl from 'tweetnacl';
import { gcm } from '@noble/ciphers/aes';
import { randomBytes } from '@noble/ciphers/utils';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Storage key ─────────────────────────────────────────────────────────────

const KEYPAIR_STORAGE_KEY = 'ed25519_keypair';

// ─── Base64 helpers (Uint8Array ↔ base64 string) ─────────────────────────────
// btoa/atob are available in React Native 0.70+ (Hermes). We convert through
// a binary string so all byte values (> 127) are handled correctly.

export function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function fromBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ─── Hex helper (exported for reportService.js) ──────────────────────────────

/**
 * Decode a 64-character hex string into a 32-byte Uint8Array.
 * Throws a descriptive error on misconfiguration so it surfaces at dev time.
 *
 * @param {string} hex   - 64-char hex-encoded 32-byte value
 * @param {string} label - Variable name shown in the error message
 * @returns {Uint8Array}
 */
export function hexToBytes(hex, label) {
  if (typeof hex !== 'string' || hex.length !== 64) {
    throw new Error(
      `${label} must be a 64-character hex string (32 bytes). ` +
        `Got: ${hex ? `${hex.length} chars` : 'undefined'}.`,
    );
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ─── 1. Key generation ───────────────────────────────────────────────────────

/**
 * Generate a fresh Ed25519 keypair.
 *
 * @returns {{ publicKey: Uint8Array(32), secretKey: Uint8Array(64) }}
 *   secretKey is the 64-byte expanded form (32-byte seed || 32-byte public key)
 *   as returned by tweetnacl.
 */
export function generateKeyPair() {
  return nacl.sign.keyPair();
}

/**
 * Load the persisted Ed25519 keypair from AsyncStorage, or generate and store
 * a new one if none exists yet.
 *
 * NOTE: For production use, replace AsyncStorage with expo-secure-store to
 * protect the private key in the platform's secure enclave / Keystore.
 *
 * @returns {Promise<{ publicKey: Uint8Array, secretKey: Uint8Array }>}
 */
export async function loadOrCreateKeyPair() {
  const raw = await AsyncStorage.getItem(KEYPAIR_STORAGE_KEY);

  if (raw) {
    const { publicKey: pubB64, secretKey: secB64 } = JSON.parse(raw);
    return {
      publicKey: fromBase64(pubB64),
      secretKey: fromBase64(secB64),
    };
  }

  const kp = generateKeyPair();

  await AsyncStorage.setItem(
    KEYPAIR_STORAGE_KEY,
    JSON.stringify({
      publicKey: toBase64(kp.publicKey),
      secretKey: toBase64(kp.secretKey),
    }),
  );

  return kp;
}

// ─── 2. Signing ──────────────────────────────────────────────────────────────

/**
 * Sign a report object with Ed25519.
 * The message is the deterministic canonical JSON of the report.
 *
 * @param {object}     reportObj  - The plaintext report (before encryption).
 * @param {Uint8Array} secretKey  - 64-byte Ed25519 secret key from generateKeyPair().
 * @returns {string} Base64-encoded 64-byte detached Ed25519 signature.
 */
export function signReport(reportObj, secretKey) {
  const message = new TextEncoder().encode(
    // Sort keys for a deterministic representation
    JSON.stringify(reportObj, Object.keys(reportObj).sort()),
  );
  const signature = nacl.sign.detached(message, secretKey);
  return toBase64(signature);
}

// ─── 3. Encryption ───────────────────────────────────────────────────────────

/**
 * Encrypt a report object with AES-256-GCM.
 * A fresh 96-bit IV is generated for every call.
 *
 * @param {object}     reportObj    - The plaintext report.
 * @param {Uint8Array} symmetricKey - 32-byte AES key.
 * @returns {{ ciphertext: string, iv: string, tag: string }}
 *   All three fields are base64-encoded strings.
 *   - iv         : 12-byte (96-bit) GCM nonce
 *   - ciphertext : encrypted bytes (plaintext length, no padding)
 *   - tag        : 16-byte GCM authentication tag
 */
export function encryptReport(reportObj, symmetricKey) {
  const plaintext = new TextEncoder().encode(JSON.stringify(reportObj));
  const iv = randomBytes(12);
  const cipher = gcm(symmetricKey, iv);

  // @noble/ciphers appends the 16-byte auth tag to the ciphertext
  const encrypted = cipher.encrypt(plaintext);
  const ciphertext = encrypted.slice(0, -16);
  const tag = encrypted.slice(-16);

  return {
    ciphertext: toBase64(ciphertext),
    iv: toBase64(iv),
    tag: toBase64(tag),
  };
}

// ─── 4. Gateway payload assembly ─────────────────────────────────────────────

/**
 * Build the final signed + encrypted payload for the API gateway.
 *
 * Steps:
 *  1. Sign the plaintext report with Ed25519 (sign-then-encrypt for content
 *     authenticity; the gateway verifies after decryption).
 *  2. Encrypt the report with AES-256-GCM.
 *  3. Pack iv || ciphertext || tag into a single binary blob and base64-encode
 *     it as the `payload` field.  The gateway decodes: iv = first 12 bytes,
 *     tag = last 16 bytes, ciphertext = everything in between.
 *
 * Wire format:
 *   {
 *     payload   : string  – base64(iv ‖ ciphertext ‖ tag)
 *     signature : string  – base64(64-byte Ed25519 detached signature)
 *     publicKey : string  – base64(32-byte Ed25519 public key)
 *     eventId   : string  – UUID of the report
 *   }
 *
 * @param {object}     report       - Canonical report { eventId, sourceId, … }
 * @param {Uint8Array} secretKey    - Ed25519 secret key (64 bytes)
 * @param {Uint8Array} publicKey    - Ed25519 public key (32 bytes)
 * @param {Uint8Array} symmetricKey - AES-256-GCM key (32 bytes)
 * @returns {{ payload: string, signature: string, publicKey: string, eventId: string }}
 */
export function buildGatewayPayload(report, secretKey, publicKey, symmetricKey) {
  // ── Sign the plaintext first ──────────────────────────────────────────────
  const signature = signReport(report, secretKey);

  // ── Encrypt ───────────────────────────────────────────────────────────────
  const plaintext = new TextEncoder().encode(JSON.stringify(report));
  const iv = randomBytes(12);
  const cipher = gcm(symmetricKey, iv);
  const encrypted = cipher.encrypt(plaintext); // ciphertext ‖ tag (16 bytes)

  // ── Pack binary envelope: iv (12) ‖ ciphertext (n) ‖ tag (16) ───────────
  const envelope = new Uint8Array(iv.length + encrypted.length);
  envelope.set(iv, 0);
  envelope.set(encrypted, iv.length);

  return {
    payload: toBase64(envelope),
    signature,
    publicKey: toBase64(publicKey),
    eventId: report.eventId,
  };
}
