'use strict';
/**
 * logger.js  –  Structured JSON logger for the storage-service (pino).
 *
 * Every log line contains:
 *   service_name    – always "storage-service"
 *   correlation_id  – from RabbitMQ message.properties.correlationId
 *                     or HTTP header x-correlation-id (caller supplies)
 *   time            – ISO-8601 timestamp
 *   level           – level name string
 *   msg             – human-readable message
 *
 * Usage
 * ─────
 *   const { logger, child } = require('./logger');
 *
 *   logger.info('Storage service starting');
 *   const msgLog = child(msg.properties.correlationId);
 *   msgLog.info({ eventId }, 'Report saved');
 */

const pino = require('pino');

const SERVICE_NAME = 'storage-service';

const logger = pino({
  base: { service_name: SERVICE_NAME },

  timestamp: pino.stdTimeFunctions.isoTime,

  formatters: {
    level(label) {
      return { level: label };
    },
  },

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
