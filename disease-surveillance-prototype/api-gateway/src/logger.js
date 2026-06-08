'use strict';
/**
 * logger.js  –  Structured JSON logger for the api-gateway (pino).
 *
 * Every log line emitted by this module contains at minimum:
 *   service_name    – always "api-gateway"
 *   correlation_id  – sourced from req.headers['x-correlation-id'] or
 *                     RabbitMQ message.properties.correlationId (caller supplies)
 *   time            – ISO-8601 timestamp (pino serialises as epoch ms by default;
 *                     we override the timestamp serialiser to emit ISO strings)
 *   level           – pino level name string
 *   msg             – human-readable message
 *
 * Usage
 * ─────
 *   const { logger, child } = require('./src/logger');
 *
 *   // Root logger (no correlation context)
 *   logger.info('Server starting');
 *
 *   // Per-request child (binds correlation_id for the lifetime of the request)
 *   const reqLog = child(req.headers['x-correlation-id']);
 *   reqLog.info({ eventId }, 'Report accepted');
 *   reqLog.error({ err }, 'Decryption failed');
 */

const pino = require('pino');

const SERVICE_NAME = 'api-gateway';

const logger = pino({
  base: { service_name: SERVICE_NAME },

  // Emit ISO-8601 timestamps instead of epoch milliseconds.
  timestamp: pino.stdTimeFunctions.isoTime,

  // Map pino's numeric level to the string label so consumers
  // (Loki, Elasticsearch, etc.) get a readable "level" field.
  formatters: {
    level(label) {
      return { level: label };
    },
  },

  // In development, pretty-print when LOG_PRETTY=true.
  ...(process.env.LOG_PRETTY === 'true' && {
    transport: { target: 'pino-pretty', options: { colorize: true, singleLine: true } },
  }),
});

/**
 * Create a child logger bound to a specific correlation ID.
 *
 * @param {string|undefined} correlationId
 * @returns {pino.Logger}
 */
function child(correlationId) {
  return logger.child({ correlation_id: correlationId || 'none' });
}

module.exports = { logger, child };
