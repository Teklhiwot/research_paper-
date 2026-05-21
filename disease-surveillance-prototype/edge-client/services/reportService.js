/**
 * reportService.js
 *
 * Handles encrypt → sign → POST for a single disease-event report, and manages
 * the AsyncStorage offline queue (key: "pending_reports").
 *
 * Encryption  : AES-256-GCM (@noble/ciphers) – 96-bit random IV per message.
 * Signing     : HMAC-SHA256 (@noble/hashes) over "ivHex.ciphertextHex".
 * Keys        : Read from Expo public env vars at call time so they can be
 *               rotated without a rebuild (set in .env):
 *                 EXPO_PUBLIC_GATEWAY_URL       – e.g. http://10.0.2.2:3000/report
 *                 EXPO_PUBLIC_REPORT_ENC_KEY    – 64-char hex (32 bytes)
 *                 EXPO_PUBLIC_REPORT_SIGN_KEY   – 64-char hex (32 bytes)
 *
 * Wire format sent to the gateway:
 *   POST /report  Content-Type: application/json
 *   { "iv": "<hex>", "data": "<hex ciphertext+authtag>", "sig": "<hex hmac>" }
 *
 * The gateway decrypts with the same AES-256-GCM key and verifies the HMAC
 * before normalising to the canonical schema.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { gcm } from '@noble/ciphers/aes';
import { randomBytes } from '@noble/ciphers/utils';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';

// ─── Constants ───────────────────────────────────────────────────────────────

export const QUEUE_KEY = 'pending_reports';

const GATEWAY_URL =
  process.env.EXPO_PUBLIC_GATEWAY_URL ?? 'http://GATEWAY_IP:3000/report';

// ─── Internal crypto helpers ─────────────────────────────────────────────────

/**
 * Decode a 64-character hex string into a 32-byte Uint8Array.
 * Throws clearly so misconfigurations surface at dev time.
 */
function hexToBytes(hex, label) {
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

function toHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Encrypt `plaintext` (Uint8Array) with AES-256-GCM.
 * Returns { ivHex, ciphertextHex } where ciphertextHex already contains the
 * 16-byte authentication tag appended by @noble/ciphers.
 */
function encryptPayload(plaintext) {
  const key = hexToBytes(process.env.EXPO_PUBLIC_REPORT_ENC_KEY, 'EXPO_PUBLIC_REPORT_ENC_KEY');
  const iv = randomBytes(12); // 96-bit nonce – recommended for AES-GCM
  const cipher = gcm(key, iv);
  const ciphertext = cipher.encrypt(plaintext);
  return { ivHex: toHex(iv), ciphertextHex: toHex(ciphertext) };
}

/**
 * Sign the envelope string "ivHex.ciphertextHex" with HMAC-SHA256.
 * Returns a hex-encoded signature string.
 */
function signEnvelope(ivHex, ciphertextHex) {
  const key = hexToBytes(process.env.EXPO_PUBLIC_REPORT_SIGN_KEY, 'EXPO_PUBLIC_REPORT_SIGN_KEY');
  const message = new TextEncoder().encode(`${ivHex}.${ciphertextHex}`);
  const sig = hmac(sha256, key, message);
  return toHex(sig);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Encrypt, sign, and POST a single report object to the API gateway.
 * Throws on crypto misconfiguration, network errors, or non-2xx responses.
 *
 * @param {object} report - The canonical report payload.
 */
export async function postReport(report) {
  const plaintext = new TextEncoder().encode(JSON.stringify(report));
  const { ivHex, ciphertextHex } = encryptPayload(plaintext);
  const sig = signEnvelope(ivHex, ciphertextHex);

  const response = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ iv: ivHex, data: ciphertextHex, sig }),
  });

  if (!response.ok) {
    throw new Error(`Gateway responded ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Append a report to the AsyncStorage pending queue.
 * This is the crash-safe persistence step; always call this before attempting
 * a network send.
 *
 * @param {object} report
 */
export async function enqueueReport(report) {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  const queue = raw ? JSON.parse(raw) : [];
  queue.push(report);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/**
 * Attempt to send every report in the pending queue.
 * Successfully sent reports are removed; failures remain for the next attempt.
 *
 * @returns {Promise<number>} The number of reports that still failed (0 = fully drained).
 */
export async function flushPendingReports() {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return 0;

  const queue = JSON.parse(raw);
  if (queue.length === 0) return 0;

  const failed = [];

  for (const report of queue) {
    try {
      await postReport(report);
    } catch (err) {
      console.warn('[reportService] Send failed for', report.eventId, '–', err.message);
      failed.push(report);
    }
  }

  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(failed));
  return failed.length;
}
