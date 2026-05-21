'use strict';

/**
 * hl7Adapter.js
 *
 * Parses a minimal HL7 v2.x pipe-delimited message and maps it to the
 * canonical disease-surveillance report schema.
 *
 * Supported segments
 *   MSH – Message Header  (sending app/facility, timestamp, message control ID)
 *   PID – Patient ID      (patient/case identifier → reporterId)
 *   OBX – Observation     (syndrome code, observation value, observation timestamp)
 *
 * Encoding assumptions (standard HL7 v2 defaults)
 *   Field separator      : |
 *   Component separator  : ^
 *   Repetition separator : ~  (repetitions are not expanded; first is used)
 *   Escape character     : \
 *   Sub-component sep    : &
 *
 * Multiple OBX segments: only the first is mapped; remaining are ignored.
 *
 * Usage
 *   const { parseHl7 } = require('./hl7Adapter');
 *   const report = parseHl7(hl7String);
 */

const FIELD_SEP = '|';
const COMP_SEP  = '^';

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Convert an HL7 v2 timestamp to ISO 8601.
 *
 * Handles formats:
 *   YYYYMMDD
 *   YYYYMMDDHHMM
 *   YYYYMMDDHHMMSS
 *   YYYYMMDDHHMMSS.ssss
 *   YYYYMMDDHHMMSS±HHMM  (timezone offset stripped; result is suffixed with Z)
 *
 * @param {string} raw
 * @returns {string|null}  ISO 8601 string or null if input is blank/invalid
 */
function hl7DateToIso(raw) {
  if (!raw) return null;

  // Strip decimal sub-seconds and timezone offset for uniform handling
  const s = String(raw).trim()
    .replace(/\.\d+/, '')          // remove .ssss
    .replace(/[+\-]\d{4}$/, '');  // remove ±HHMM offset

  if (s.length < 8) return null;

  const year = s.slice(0,  4);
  const mon  = s.slice(4,  6);
  const day  = s.slice(6,  8);
  const hour = s.slice(8,  10) || '00';
  const min  = s.slice(10, 12) || '00';
  const sec  = s.slice(12, 14) || '00';

  // Basic sanity – year must be 4 digits
  if (!/^\d{4}$/.test(year)) return null;

  return `${year}-${mon}-${day}T${hour}:${min}:${sec}Z`;
}

/**
 * Return the nth component (1-based) of a pipe-field string.
 * Components are separated by '^'; absent components return ''.
 *
 * @param {string|undefined} field
 * @param {number}           n      1-based component index
 * @returns {string}
 */
function component(field, n) {
  if (!field) return '';
  const parts = String(field).split(COMP_SEP);
  return (parts[n - 1] ?? '').trim();
}

/**
 * Split one segment line by the field separator and return the array.
 * index 0 = segment name (e.g. 'MSH'), index 1 = first field value, …
 *
 * NOTE: For MSH, MSH.1 is the field separator itself ('|'), which is consumed
 * by the split.  Therefore for MSH only:  array[N-1] = HL7 field MSH.N.
 * For all other segments:               array[N]   = HL7 field SEG.N.
 */
function splitFields(line) {
  return line.split(FIELD_SEP);
}

/**
 * Parse the raw HL7 string into a map of segment-name → array-of-field-arrays.
 * Segments that appear more than once (e.g. multiple OBX) are each appended.
 *
 * @param {string} raw
 * @returns {Object.<string, string[][]>}
 */
function parseSegmentMap(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new TypeError('HL7 input must be a non-empty string');
  }

  const map = {};
  const lines = raw.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const name = line.slice(0, 3).toUpperCase();
    if (!map[name]) map[name] = [];
    map[name].push(splitFields(line));
  }

  return map;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a minimal HL7 v2 message and return canonical surveillance report fields.
 *
 * Field mappings
 * ┌──────────────────────────────────┬──────────────────────────────────────┐
 * │ Canonical field                  │ HL7 source                           │
 * ├──────────────────────────────────┼──────────────────────────────────────┤
 * │ eventId                          │ MSH.10 – Message Control ID          │
 * │ sourceId                         │ MSH.3  – Sending Application         │
 * │ timestamp                        │ OBX.14 – Obs DateTime (→ MSH.7)      │
 * │ syndromeCode                     │ OBX.3.1 – Obs ID code (→ .2 text)    │
 * │ location                         │ MSH.4  – Sending Facility            │
 * │ reporterId                       │ PID.3.1 – Patient Identifier (→ PID.2)│
 * │ notes                            │ OBX.5  – Observation Value           │
 * └──────────────────────────────────┴──────────────────────────────────────┘
 *
 * @param {string} raw  Raw HL7 v2 pipe-delimited message string
 * @returns {{
 *   eventId:      string|null,
 *   sourceId:     string|null,
 *   timestamp:    string|null,
 *   syndromeCode: string|null,
 *   location:     string|null,
 *   reporterId:   string|null,
 *   notes:        string
 * }}
 * @throws {TypeError} if input is not a string
 * @throws {Error}     if the MSH segment is absent
 */
function parseHl7(raw) {
  const segs = parseSegmentMap(raw);

  if (!segs.MSH || segs.MSH.length === 0) {
    throw new Error('HL7 parse error: MSH segment not found');
  }

  // ── MSH ──────────────────────────────────────────────────────────────────
  // After splitting by '|' the MSH.1 character is consumed, so:
  //   msh[0] = 'MSH',  msh[1] = MSH.2 ('^~\&'),
  //   msh[2] = MSH.3 (Sending Application),
  //   msh[3] = MSH.4 (Sending Facility),
  //   msh[6] = MSH.7 (Message DateTime),
  //   msh[9] = MSH.10 (Message Control ID)
  const msh = segs.MSH[0];

  const sendingApp      = (msh[2]  || '').trim();  // MSH.3
  const sendingFacility = (msh[3]  || '').trim();  // MSH.4
  const mshTimestamp    = (msh[6]  || '').trim();  // MSH.7
  const msgControlId    = (msh[9]  || '').trim();  // MSH.10

  // ── PID ───────────────────────────────────────────────────────────────────
  // pid[3] = PID.3 Patient Identifier List (CX: id^authority^type^…)
  // pid[2] = PID.2 Patient ID (deprecated; fallback)
  const pid       = segs.PID?.[0] ?? [];
  const patientId = component(pid[3], 1) || component(pid[2], 1) || null;

  // ── OBX (first occurrence only) ───────────────────────────────────────────
  // obx[2]  = OBX.2  Value Type  (ST, NM, CWE, CE, TX, …)
  // obx[3]  = OBX.3  Observation Identifier  (CWE: code^text^system)
  // obx[5]  = OBX.5  Observation Value
  // obx[14] = OBX.14 Date/Time of Observation
  const obx = segs.OBX?.[0] ?? [];

  const valueType   = (obx[2] || '').trim().toUpperCase();
  const obxIdCode   = component(obx[3], 1);   // OBX.3.1 – coded identifier
  const obxIdText   = component(obx[3], 2);   // OBX.3.2 – display text
  const syndromeCode = obxIdCode || obxIdText || null;

  // For coded value types use display text as the note; otherwise use raw value
  let notes;
  if (valueType === 'CWE' || valueType === 'CE') {
    notes = component(obx[5], 2) || component(obx[5], 1) || '';
  } else {
    notes = (obx[5] || '').trim();
  }

  // Prefer observation-level timestamp (OBX.14) over message-level (MSH.7)
  const rawTimestamp = (obx[14] || '').trim() || mshTimestamp;

  return {
    eventId:      msgControlId    || null,
    sourceId:     sendingApp      || null,
    timestamp:    hl7DateToIso(rawTimestamp),
    syndromeCode: syndromeCode,
    location:     sendingFacility || null,
    reporterId:   patientId,
    notes:        notes,
  };
}

module.exports = { parseHl7 };
