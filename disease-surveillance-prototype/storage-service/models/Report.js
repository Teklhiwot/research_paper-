'use strict';

/**
 * models/Report.js
 *
 * Mongoose model for a validated surveillance report.
 *
 * Field-level encryption
 * ──────────────────────
 * The `reporterId` and `notes` fields contain PII and are encrypted with
 * AES-256-GCM before the document is persisted.  The pre-save hook:
 *
 *   1. Builds a canonical JSON object from ALL fields while they are still
 *      in plaintext, then computes and stores sha256Hash.
 *   2. Encrypts `reporterId` and `notes` with the key derived from the
 *      STORAGE_ENC_KEY environment variable.
 *
 * Encryption happens only when a field is being set or modified so that
 * routine status updates (e.g. status → 'alerted') never accidentally
 * re-encrypt already-encrypted values loaded from the database.
 *
 * sha256Hash
 * ──────────
 * Computed with Node.js crypto.createHash('sha256') over a JSON string whose
 * keys are sorted alphabetically (for determinism) and whose values are the
 * original plaintext values.  Re-computed whenever any field included in the
 * canonical object is marked as modified.
 */

const crypto   = require('crypto');
const mongoose = require('mongoose');

const { deriveKey, encryptField } = require('../src/encrypt');

// ─── Lazy key derivation (reads env once; throws on first use if missing) ─────

let _encKey = null;

function getEncKey() {
  if (!_encKey) {
    _encKey = deriveKey(process.env.STORAGE_ENC_KEY);
  }
  return _encKey;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const reportSchema = new mongoose.Schema(
  {
    eventId: {
      type:     String,
      required: true,
      unique:   true,
      index:    true,
    },
    sourceId: {
      type:     String,
      required: true,
    },
    // Unix epoch milliseconds – stored as Number for easy range queries
    timestamp: {
      type:     Number,
      required: true,
    },
    syndromeCode: {
      type:     String,
      required: true,
      index:    true,
    },
    location: {
      type:     String,
      required: true,
    },
    // Encrypted before save – stored as JSON { iv, authTag, ciphertext }
    reporterId: {
      type:     String,
      required: true,
    },
    // Encrypted before save – stored as JSON { iv, authTag, ciphertext }
    notes: {
      type:    String,
      default: '',
    },
    status: {
      type:     String,
      enum:     ['validated', 'alerted', 'corrected'],
      required: true,
    },
    // SHA-256 of the canonical plaintext JSON (computed in pre-save hook)
    sha256Hash: {
      type:  String,
      index: true,
    },
    // Raw encrypted event payload forwarded from the API gateway
    encryptedPayload: {
      type: String,
    },
  },
  {
    timestamps: true,   // createdAt / updatedAt managed by Mongoose
    versionKey: false,
  },
);

// ─── Canonical JSON fields (must match the set included in sha256Hash) ────────

// All fields whose values contribute to the document fingerprint.
// Keys are listed in alphabetical order so JSON.stringify produces a
// deterministic string without a custom replacer.
const CANONICAL_FIELDS = [
  'eventId',
  'location',
  'notes',
  'reporterId',
  'sourceId',
  'status',
  'syndromeCode',
  'timestamp',
];

// ─── Pre-save hook ────────────────────────────────────────────────────────────

reportSchema.pre('save', function preSave(next) {
  // Determine whether any canonical field is being set or updated.
  // this.isNew is true for brand-new documents; Mongoose marks all fields
  // as modified on new docs so the check below naturally covers first saves.
  const anyCanonicalModified = this.isNew
    || CANONICAL_FIELDS.some((field) => this.isModified(field));

  if (anyCanonicalModified) {
    // Step 1 – compute sha256Hash while ALL fields are still in plaintext.
    // Build canonical object with sorted keys and current (plaintext) values.
    const canonicalObj = {};
    for (const field of CANONICAL_FIELDS) {
      canonicalObj[field] = this[field];
    }
    const canonicalJson = JSON.stringify(canonicalObj);
    this.sha256Hash = crypto
      .createHash('sha256')
      .update(canonicalJson, 'utf8')
      .digest('hex');
  }

  // Step 2 – encrypt sensitive fields.
  // Only encrypt when the field has been explicitly set or modified so that
  // loading an existing document and saving it with an unrelated change
  // (e.g. status update) does not double-encrypt values from the database.
  const key = getEncKey();

  if (this.isModified('reporterId') && this.reporterId) {
    this.reporterId = encryptField(this.reporterId, key);
  }

  if (this.isModified('notes') && this.notes) {
    this.notes = encryptField(this.notes, key);
  }

  next();
});

// ─── Compound indexes ─────────────────────────────────────────────────────────

// Supports time-range queries scoped to a syndrome (e.g. dashboard charts).
reportSchema.index({ syndromeCode: 1, timestamp: -1 });

// Supports time-range queries scoped to a location (e.g. geo drilldown).
reportSchema.index({ location: 1, timestamp: -1 });

// Explicit single-field index on sha256Hash for fast dedup / lookup by hash.
// (The field-level `index: true` in the schema definition creates the same
// index; declaring it here makes it visible alongside the compound indexes.)
reportSchema.index({ sha256Hash: 1 });

// ─── Static methods ───────────────────────────────────────────────────────────

/**
 * Find a report by its SHA-256 canonical hash.
 *
 * @param {string} hash - 64-character hex string
 * @returns {Promise<import('mongoose').Document|null>}
 */
reportSchema.statics.findByHash = function findByHash(hash) {
  return this.findOne({ sha256Hash: hash });
};

// ─── Model ────────────────────────────────────────────────────────────────────

const Report = mongoose.model('Report', reportSchema);

module.exports = Report;
