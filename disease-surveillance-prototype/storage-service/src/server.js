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

const express  = require('express');
const jwt      = require('jsonwebtoken');
const amqplib  = require('amqplib');
const mongoose = require('mongoose');

const { logger, child } = require('./logger');
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
  logger.fatal({ correlation_id: 'none' }, 'JWT_SECRET environment variable is required');
  process.exit(1);
}
if (!STORAGE_ENC_KEY) {
  logger.fatal({ correlation_id: 'none' }, 'STORAGE_ENC_KEY environment variable is required');
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

// ── Correlation-ID middleware ───────────────────────────────────────────────────
app.use((req, _res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || 'none';
  next();
});

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

  const log = child(req.correlationId);

  let doc;
  try {
    doc = await Report.findOne({ eventId }).lean();
  } catch (err) {
    log.error({ eventId, err: err.message }, 'DB error fetching report');
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
  // Extract correlation_id from AMQP message properties (set by api-gateway)
  const correlationId = msg.properties.correlationId || 'none';
  const log = child(correlationId);

  let body;
  try {
    body = JSON.parse(msg.content.toString('utf8'));
  } catch (err) {
    log.error({ err: err.message }, 'Cannot parse AMQP message body');
    channel.nack(msg, false, false);   // unrecoverable – send to DLX
    return;
  }

  const hint = body.eventId || '<unknown>';

  // Step 2 – coerce / validate required fields
  if (!body.eventId || !body.sourceId || !body.syndromeCode || !body.location || !body.reporterId) {
    log.warn({ eventId: hint }, 'Message missing required fields – discarding');
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
    log.info({ eventId: hint, sha256Hash: report.sha256Hash.slice(0, 12) }, 'Report saved');
  } catch (err) {
    if (err.code === 11000) {
      log.warn({ eventId: hint }, 'Duplicate eventId – already stored, discarding');
      channel.ack(msg);
    } else {
      log.error({ eventId: hint, err: err.message }, 'Failed to save report');
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
      logger.info({ correlation_id: 'none' }, 'Connecting to RabbitMQ');
      conn = await amqplib.connect(RABBITMQ_URL);

      conn.on('error', (err) => {
        logger.error({ correlation_id: 'none', err: err.message }, 'RabbitMQ connection error');
      });

      const channel = await conn.createChannel();
      await channel.prefetch(PREFETCH_COUNT);

      // Idempotent topology: exchange + queue + binding
      await channel.assertExchange(STORAGE_EXCHANGE, 'topic', { durable: true });
      await channel.assertQueue(STORAGE_QUEUE, { durable: true });
      await channel.bindQueue(STORAGE_QUEUE, STORAGE_EXCHANGE, STORAGE_RKEY);

      logger.info({ correlation_id: 'none', queue: STORAGE_QUEUE }, 'RabbitMQ consumer ready');

      await channel.consume(
        STORAGE_QUEUE,
        (msg) => {
          if (!msg) return;   // consumer cancelled by broker
          handleMessage(channel, msg).catch((err) => {
            logger.error({ correlation_id: msg.properties.correlationId || 'none', err: err.message }, 'Unhandled error in handleMessage');
            try { channel.nack(msg, false, false); } catch { /* channel may be closed */ }
          });
        },
        { noAck: false },
      );

      // Block until the connection drops, then fall through to reconnect
      await new Promise((resolve) => conn.on('close', resolve));
      logger.warn({ correlation_id: 'none', retryMs: RECONNECT_DELAY_MS }, 'RabbitMQ connection closed – reconnecting');
    } catch (err) {
      logger.error({ correlation_id: 'none', err: err.message, retryMs: RECONNECT_DELAY_MS }, 'RabbitMQ error – retrying');
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
  logger.info({ correlation_id: 'none', uri: MONGODB_URI }, 'MongoDB connected');

  // 2. RabbitMQ consumer (runs in the background; errors are logged + retried)
  startConsumer().catch((err) => {
    logger.error({ correlation_id: 'none', err: err.message }, 'Consumer exited unexpectedly');
  });

  // 3. HTTP server
  app.listen(PORT, () => {
    logger.info({ correlation_id: 'none', port: PORT }, 'storage-service HTTP server listening');
  });
}

start().catch((err) => {
  logger.fatal({ correlation_id: 'none', err: err.message }, 'Startup failed');
  process.exit(1);
});

module.exports = app;   // exported for testing

