'use strict';

/**
 * server.js  –  Storage Service entry point
 *
 * Responsibilities
 * ────────────────
 *  1. Connect to MongoDB via Mongoose.
 *  2. Connect to RabbitMQ and consume from queue ``storage.incoming``
 *     (bound to exchange ``surveillance.storage``, routing key ``report.store``).
 *  3. For each message:
 *       a. Parse and coerce the payload.
 *       b. Persist a Report document – the pre-save hook computes the
 *          SHA-256 canonical hash and encrypts `reporterId` / `notes`
 *          automatically (AES-256-GCM, key from STORAGE_ENC_KEY).
 *       c. ACK on success; NACK (no requeue) on unrecoverable errors.
 *          Duplicate eventId → ACK (idempotent, already stored).
 *  4. Expose  GET /report/:eventId  (Bearer JWT required) that retrieves the
 *     document, decrypts sensitive fields, and returns plain JSON.
 *  5. Expose  GET /health  (unauthenticated).
 *
 * Environment variables
 * ─────────────────────
 *  PORT            HTTP port (default 4000)
 *  MONGODB_URI     MongoDB connection string (default localhost)
 *  RABBITMQ_URL    AMQP URL (default amqp://guest:guest@localhost/)
 *  STORAGE_ENC_KEY AES-256 key source (required – hashed to 32 bytes)
 *  JWT_SECRET      HS256 secret for Bearer token verification (required)
 */

require('dotenv').config();

const crypto   = require('crypto');
const express  = require('express');
const jwt      = require('jsonwebtoken');
const amqplib  = require('amqplib');
const mongoose = require('mongoose');

const Report = require('../models/Report');
const { deriveKey, decryptField } = require('./encrypt');

// ─── Configuration ────────────────────────────────────────────────────────────

const PORT         = Number(process.env.PORT)         || 4000;
const MONGODB_URI  = process.env.MONGODB_URI          || 'mongodb://localhost:27017/surveillance';
const RABBITMQ_URL = process.env.RABBITMQ_URL         || 'amqp://guest:guest@localhost/';
const JWT_SECRET   = process.env.JWT_SECRET;
const STORAGE_ENC_KEY = process.env.STORAGE_ENC_KEY;

// RabbitMQ topology – must match forwarder.py constants
const STORAGE_EXCHANGE = 'surveillance.storage';
const STORAGE_QUEUE    = 'storage.incoming';
const STORAGE_RKEY     = 'report.store';

const RECONNECT_DELAY_MS = 5_000;
const PREFETCH_COUNT     = 10;

// ─── Startup validation ───────────────────────────────────────────────────────

if (!JWT_SECRET) {
  console.error('[storage] FATAL: JWT_SECRET environment variable is required');
  process.exit(1);
}
if (!STORAGE_ENC_KEY) {
  console.error('[storage] FATAL: STORAGE_ENC_KEY environment variable is required');
  process.exit(1);
}

// Derive the encryption key once at startup so any misconfiguration is caught
// immediately rather than at first save.
const ENC_KEY = deriveKey(STORAGE_ENC_KEY);

// ─── Timestamp coercion ───────────────────────────────────────────────────────

/**
 * Accept a timestamp in multiple formats and return Unix epoch milliseconds.
 * Handles: Number, numeric string, ISO-8601 string.  Falls back to Date.now().
 * @param {*} raw
 * @returns {number}
 */
function parseTimestamp(raw) {
  if (typeof raw === 'number' && !Number.isNaN(raw)) return raw;
  const asNum = Number(raw);
  if (!Number.isNaN(asNum) && asNum > 0) return asNum;
  const asDate = new Date(raw);
  return Number.isNaN(asDate.getTime()) ? Date.now() : asDate.getTime();
}

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// ── Auth middleware ────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing or malformed' });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET, { algorithms: ['HS256'] });
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ service: 'storage-service', status: 'ok' });
});

/**
 * GET /report/:eventId
 *
 * Returns the stored surveillance report with sensitive fields decrypted.
 * Requires a valid HS256 Bearer token signed with JWT_SECRET.
 */
app.get('/report/:eventId', requireAuth, async (req, res) => {
  const { eventId } = req.params;

  // Basic input validation – eventId must be a non-empty string
  if (!eventId || typeof eventId !== 'string' || eventId.length > 256) {
    return res.status(400).json({ error: 'Invalid eventId' });
  }

  let doc;
  try {
    doc = await Report.findOne({ eventId }).lean();
  } catch (err) {
    console.error('[storage] DB error fetching %s: %s', eventId, err.message);
    return res.status(500).json({ error: 'Database error' });
  }

  if (!doc) {
    return res.status(404).json({ error: 'Report not found' });
  }

  // Decrypt sensitive fields; fall back to the stored value if decryption
  // fails (e.g. document pre-dates encryption, or was stored unencrypted).
  const result = { ...doc };
  try {
    result.reporterId = decryptField(doc.reporterId, ENC_KEY);
  } catch {
    // keep stored value as-is
  }
  if (doc.notes) {
    try {
      result.notes = decryptField(doc.notes, ENC_KEY);
    } catch {
      // keep stored value as-is
    }
  }

  return res.json(result);
});

// ─── RabbitMQ consumer ────────────────────────────────────────────────────────

/**
 * Process one incoming AMQP message:
 *  1. JSON-decode the body.
 *  2. Coerce fields into their schema types.
 *  3. Save a new Report document.
 *     The pre-save hook computes sha256Hash (canonical JSON) and encrypts
 *     `reporterId` and `notes` before the document reaches MongoDB.
 *  4. ACK on success; ACK on duplicate key (idempotent); NACK otherwise.
 */
async function handleMessage(channel, msg) {
  // Step 1 – JSON decode
  let body;
  try {
    body = JSON.parse(msg.content.toString('utf8'));
  } catch (err) {
    console.error('[storage] Cannot parse message body: %s', err.message);
    channel.nack(msg, false, false);   // unrecoverable – send to DLX
    return;
  }

  const hint = body.eventId || '<unknown>';

  // Step 2 – coerce / validate required fields
  if (!body.eventId || !body.sourceId || !body.syndromeCode || !body.location || !body.reporterId) {
    console.warn('[storage] Message %s missing required fields – discarding', hint);
    channel.nack(msg, false, false);
    return;
  }

  const docFields = {
    eventId:          String(body.eventId),
    sourceId:         String(body.sourceId),
    timestamp:        parseTimestamp(body.timestamp),
    syndromeCode:     String(body.syndromeCode),
    location:         String(body.location),
    reporterId:       String(body.reporterId),
    notes:            body.notes != null ? String(body.notes) : '',
    status:           ['validated', 'alerted', 'corrected'].includes(body.status)
                        ? body.status
                        : 'validated',
    encryptedPayload: body.encryptedPayload || undefined,
  };

  // Steps 3 + 4 – save via Mongoose (pre-save hook handles hash + encryption)
  try {
    const report = new Report(docFields);
    await report.save();
    channel.ack(msg);
    console.log('[storage] Saved event %s (hash=%s…)', hint, report.sha256Hash.slice(0, 12));
  } catch (err) {
    if (err.code === 11000) {
      // Duplicate eventId – already persisted; ack so the message is removed
      console.warn('[storage] Duplicate eventId %s – already stored, discarding', hint);
      channel.ack(msg);
    } else {
      console.error('[storage] Failed to save event %s: %s', hint, err.message);
      channel.nack(msg, false, false);   // send to DLX for inspection
    }
  }
}

/**
 * Connect to RabbitMQ, declare topology, and consume storage.incoming forever.
 * Reconnects after RECONNECT_DELAY_MS on any connection or channel error.
 */
async function startConsumer() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let conn;
    try {
      console.log('[storage] Connecting to RabbitMQ …');
      conn = await amqplib.connect(RABBITMQ_URL);

      conn.on('error', (err) => {
        console.error('[storage] RabbitMQ connection error: %s', err.message);
      });

      const channel = await conn.createChannel();
      await channel.prefetch(PREFETCH_COUNT);

      // Idempotent topology: exchange + queue + binding
      await channel.assertExchange(STORAGE_EXCHANGE, 'topic', { durable: true });
      await channel.assertQueue(STORAGE_QUEUE, { durable: true });
      await channel.bindQueue(STORAGE_QUEUE, STORAGE_EXCHANGE, STORAGE_RKEY);

      console.log('[storage] Consuming %s', STORAGE_QUEUE);

      await channel.consume(
        STORAGE_QUEUE,
        (msg) => {
          if (!msg) return;   // consumer cancelled by broker
          handleMessage(channel, msg).catch((err) => {
            console.error('[storage] Unhandled error in handleMessage: %s', err.message);
            try { channel.nack(msg, false, false); } catch { /* channel may be closed */ }
          });
        },
        { noAck: false },
      );

      // Block until the connection drops, then fall through to reconnect
      await new Promise((resolve) => conn.on('close', resolve));
      console.warn('[storage] RabbitMQ connection closed – reconnecting in %dms', RECONNECT_DELAY_MS);
    } catch (err) {
      console.error('[storage] RabbitMQ error: %s – retrying in %dms', err.message, RECONNECT_DELAY_MS);
    } finally {
      if (conn) {
        try { await conn.close(); } catch { /* already closed */ }
      }
    }

    await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function start() {
  // 1. MongoDB
  await mongoose.connect(MONGODB_URI);
  console.log('[storage] MongoDB connected: %s', MONGODB_URI);

  // 2. RabbitMQ consumer (runs in the background; errors are logged + retried)
  startConsumer().catch((err) => {
    console.error('[storage] Consumer exited unexpectedly: %s', err.message);
  });

  // 3. HTTP server
  app.listen(PORT, () => {
    console.log('[storage] HTTP server listening on port %d', PORT);
  });
}

start().catch((err) => {
  console.error('[storage] Startup failed: %s', err.message);
  process.exit(1);
});

module.exports = app;   // exported for testing

