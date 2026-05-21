'use strict';

require('dotenv').config();

const express = require('express');
const crypto  = require('crypto');   // built-in – AES-256-GCM decryption
const nacl    = require('tweetnacl'); // Ed25519 signature verification
const amqp    = require('amqplib');

// ─── Configuration ────────────────────────────────────────────────────────────

const PORT           = process.env.PORT           || 3000;
const RABBITMQ_URL   = process.env.RABBITMQ_URL   || 'amqp://localhost:5672';
const DECRYPT_KEY_HEX = process.env.GATEWAY_DECRYPT_KEY;  // 64-char hex (32 bytes)

const EXCHANGE    = 'surveillance.reports';
const ROUTING_KEY = 'report.new';

// ─── RabbitMQ connection management ──────────────────────────────────────────

let mqChannel    = null;
let mqConnecting = false;

async function connectRabbitMQ() {
  if (mqConnecting) return;
  mqConnecting = true;

  try {
    const conn = await amqp.connect(RABBITMQ_URL);
    const ch   = await conn.createChannel();

    await ch.assertExchange(EXCHANGE, 'topic', { durable: true });

    // Reconnect automatically on connection-level errors or graceful closes
    conn.on('error', (err) => {
      console.error('[RabbitMQ] Connection error:', err.message);
      mqChannel = null;
      setTimeout(connectRabbitMQ, 5000);
    });
    conn.on('close', () => {
      console.warn('[RabbitMQ] Connection closed – reconnecting in 5 s');
      mqChannel = null;
      setTimeout(connectRabbitMQ, 5000);
    });

    mqChannel    = ch;
    mqConnecting = false;
    console.log('[RabbitMQ] Connected. Exchange ready:', EXCHANGE);
  } catch (err) {
    mqConnecting = false;
    console.error('[RabbitMQ] Failed to connect:', err.message, '– retrying in 5 s');
    setTimeout(connectRabbitMQ, 5000);
  }
}

// ─── Crypto helpers ───────────────────────────────────────────────────────────

/**
 * Decode a 64-char hex string to a 32-byte Buffer.
 * Throws a descriptive error on misconfiguration.
 */
function parseHexKey(hex, label) {
  if (!hex || hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`${label} must be a 64-character hex string (32 bytes)`);
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Decrypt an AES-256-GCM binary envelope produced by the edge client.
 *
 * Binary layout: iv (12 bytes) ‖ ciphertext (n bytes) ‖ GCM auth tag (16 bytes)
 *
 * @param {string} payloadBase64 – base64-encoded binary envelope
 * @param {Buffer} key           – 32-byte AES-256 key
 * @returns {object}               Parsed JSON report object
 * @throws if the auth tag is invalid (tampered data / wrong key)
 */
function decryptPayload(payloadBase64, key) {
  const buf = Buffer.from(payloadBase64, 'base64');

  // Minimum: 12 (IV) + 0 (empty ciphertext) + 16 (tag) = 28 bytes
  if (buf.length < 28) {
    throw new Error('Payload too short to be a valid AES-256-GCM envelope');
  }

  const iv         = buf.subarray(0, 12);
  const tag        = buf.subarray(buf.length - 16);
  const ciphertext = buf.subarray(12, buf.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(), // throws ERR_CRYPTO_GCM_AUTH_TAG_MISMATCH if tag invalid
  ]);

  return JSON.parse(decrypted.toString('utf8'));
}

/**
 * Verify an Ed25519 detached signature.
 *
 * The edge client signs over sorted-key canonical JSON so the representation
 * is deterministic regardless of insertion order.
 *
 * @param {object} reportObj        – decrypted report (after decrypt, before normalise)
 * @param {string} signatureBase64  – base64-encoded 64-byte Ed25519 signature
 * @param {string} publicKeyBase64  – base64-encoded 32-byte Ed25519 public key
 * @returns {boolean}
 */
function verifySignature(reportObj, signatureBase64, publicKeyBase64) {
  const message  = Buffer.from(
    JSON.stringify(reportObj, Object.keys(reportObj).sort()),
  );
  const signature = Buffer.from(signatureBase64, 'base64');
  const publicKey = Buffer.from(publicKeyBase64, 'base64');

  if (signature.length !== 64 || publicKey.length !== 32) return false;

  return nacl.sign.detached.verify(
    new Uint8Array(message),
    new Uint8Array(signature),
    new Uint8Array(publicKey),
  );
}

// ─── Schema normaliser ───────────────────────────────────────────────────────

const REQUIRED_FIELDS = [
  'eventId', 'sourceId', 'timestamp',
  'syndromeCode', 'location', 'reporterId',
];

/**
 * Normalise a raw decrypted report to the canonical surveillance schema.
 *
 * @param {object} raw – decrypted report object from the edge client
 * @returns {{ eventId, sourceId, timestamp, syndromeCode, location, reporterId, notes, status }}
 * @throws if any required field is absent or empty
 */
function normaliseReport(raw) {
  const missing = REQUIRED_FIELDS.filter((f) => !raw[f]);
  if (missing.length > 0) {
    throw new Error(`Report missing required fields: ${missing.join(', ')}`);
  }

  return {
    eventId:      String(raw.eventId).trim(),
    sourceId:     String(raw.sourceId).trim(),
    timestamp:    String(raw.timestamp).trim(),
    syndromeCode: String(raw.syndromeCode).trim().toUpperCase(),
    location:     String(raw.location).trim(),
    reporterId:   String(raw.reporterId).trim(),
    notes:        raw.notes ? String(raw.notes).trim() : '',
    status:       'pending',
  };
}

// ─── Express application ─────────────────────────────────────────────────────

const app = express();

// Constrain body size to prevent oversized payloads (DoS mitigation)
app.use(express.json({ limit: '64kb' }));

// ── GET / – health check ─────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    service: 'api-gateway',
    status:  'ok',
    mq:      mqChannel ? 'connected' : 'disconnected',
  });
});

// ── POST /report ─────────────────────────────────────────────────────────────
/**
 * Accepts a signed + encrypted disease-event report from an edge client.
 *
 * Expected body:
 *   {
 *     payload   : string  – base64(iv ‖ ciphertext ‖ AES-GCM tag)
 *     signature : string  – base64(Ed25519 detached signature over plaintext)
 *     publicKey : string  – base64(Ed25519 public key, 32 bytes)
 *     eventId   : string  – UUID echoed from the plaintext payload
 *   }
 *
 * Responses:
 *   202 { accepted: true, eventId }  – report accepted and queued
 *   400 { error }                    – malformed request or schema violation
 *   401 { error }                    – signature verification failed
 *   503 { error }                    – message queue temporarily unavailable
 */
app.post('/report', async (req, res, next) => {
  try {
    const { payload, signature, publicKey, eventId } = req.body ?? {};

    // ── 1. Validate envelope fields ─────────────────────────────────────────
    if (!payload || !signature || !publicKey || !eventId) {
      return res.status(400).json({
        error: 'Missing required fields: payload, signature, publicKey, eventId',
      });
    }

    // ── 2. Parse AES key from env ────────────────────────────────────────────
    let aesKey;
    try {
      aesKey = parseHexKey(DECRYPT_KEY_HEX, 'GATEWAY_DECRYPT_KEY');
    } catch (err) {
      // Key misconfiguration is a server-side problem
      console.error('[POST /report] Key configuration error:', err.message);
      return next(err);
    }

    // ── 3. Decrypt AES-256-GCM payload ──────────────────────────────────────
    let decrypted;
    try {
      decrypted = decryptPayload(payload, aesKey);
    } catch (err) {
      return res.status(400).json({ error: 'Decryption failed – invalid payload or key' });
    }

    // ── 4. Verify Ed25519 signature over plaintext ───────────────────────────
    //    (sign-then-encrypt: signature was made before encryption on the edge)
    if (!verifySignature(decrypted, signature, publicKey)) {
      return res.status(401).json({ error: 'Signature verification failed' });
    }

    // ── 5. Cross-check envelope eventId with decrypted eventId ──────────────
    if (decrypted.eventId !== eventId) {
      return res.status(400).json({ error: 'eventId mismatch between envelope and payload' });
    }

    // ── 6. Normalise to canonical schema ─────────────────────────────────────
    let normalised;
    try {
      normalised = normaliseReport(decrypted);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    // ── 7. Publish to RabbitMQ ───────────────────────────────────────────────
    //    TODO: check Redis for duplicate eventId before publishing
    if (!mqChannel) {
      return res.status(503).json({ error: 'Message queue unavailable – try again shortly' });
    }

    mqChannel.publish(
      EXCHANGE,
      ROUTING_KEY,
      Buffer.from(JSON.stringify(normalised)),
      { persistent: true, contentType: 'application/json' },
    );

    // ── 8. 202 Accepted ──────────────────────────────────────────────────────
    return res.status(202).json({ accepted: true, eventId: normalised.eventId });
  } catch (err) {
    next(err);
  }
});

// ── Centralised error handler ─────────────────────────────────────────────────
// Express 5 forwards async errors automatically; this handles remaining cases.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[api-gateway] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Startup ──────────────────────────────────────────────────────────────────

async function start() {
  if (!DECRYPT_KEY_HEX) {
    throw new Error('GATEWAY_DECRYPT_KEY environment variable is required');
  }

  // HTTP server starts immediately; RabbitMQ connection is established
  // asynchronously with automatic retries so the gateway can serve health
  // checks while the broker is still warming up (Docker compose scenario).
  app.listen(PORT, () => {
    console.log(`[api-gateway] Listening on :${PORT}`);
  });

  connectRabbitMQ().catch((err) => {
    console.error('[RabbitMQ] Initial connect attempt failed:', err.message);
  });
}

start().catch((err) => {
  console.error('[api-gateway] Fatal startup error:', err.message);
  process.exit(1);
});

module.exports = app;
