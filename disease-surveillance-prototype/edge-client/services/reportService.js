/**
 * reportService.js
 *
 * Offline-resilient report submission for the disease-surveillance edge client.
 *
 * Crypto is delegated entirely to utils/crypto.js:
 *   • Ed25519 signing   (tweetnacl) – sign-then-encrypt
 *   • AES-256-GCM       (@noble/ciphers) – 96-bit IV per message
 *   • Keypair persisted to AsyncStorage (rotate via loadOrCreateKeyPair)
 *
 * Wire format sent to the gateway (POST /report, application/json):
 *   {
 *     payload   : base64(iv ‖ ciphertext ‖ tag)   – encrypted report
 *     signature : base64(Ed25519 detached sig)     – over plaintext
 *     publicKey : base64(Ed25519 public key)
 *     eventId   : UUID string
 *   }
 *
 * Env vars (set in .env):
 *   EXPO_PUBLIC_GATEWAY_URL     – e.g. http://10.0.2.2:3000/report
 *   EXPO_PUBLIC_REPORT_ENC_KEY  – 64-char hex (32-byte AES-256 key)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadOrCreateKeyPair,
  buildGatewayPayload,
  hexToBytes,
} from '../utils/crypto';

// ─── Constants ───────────────────────────────────────────────────────────────

export const QUEUE_KEY = 'pending_reports';

const GATEWAY_URL =
  process.env.EXPO_PUBLIC_GATEWAY_URL ?? 'http://GATEWAY_IP:3000/report';

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Sign, encrypt, and POST a single report to the API gateway.
 * Throws on crypto misconfiguration, network errors, or non-2xx responses.
 *
 * @param {object} report - Canonical { eventId, sourceId, timestamp, … }
 */
export async function postReport(report) {
  const { publicKey, secretKey } = await loadOrCreateKeyPair();
  const symmetricKey = hexToBytes(
    process.env.EXPO_PUBLIC_REPORT_ENC_KEY,
    'EXPO_PUBLIC_REPORT_ENC_KEY',
  );

  const wirePayload = buildGatewayPayload(report, secretKey, publicKey, symmetricKey);

  const response = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(wirePayload),
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
