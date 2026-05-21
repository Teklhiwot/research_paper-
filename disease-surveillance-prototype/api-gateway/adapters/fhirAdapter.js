'use strict';

/**
 * fhirAdapter.js
 *
 * Maps a FHIR R4 Observation resource (JSON object) to the canonical
 * disease-surveillance report schema.
 *
 * FHIR R4 Observation spec: https://hl7.org/fhir/R4/observation.html
 *
 * Field mappings
 * ┌──────────────────────────────────┬──────────────────────────────────────────────────┐
 * │ Canonical field                  │ FHIR R4 Observation source                       │
 * ├──────────────────────────────────┼──────────────────────────────────────────────────┤
 * │ eventId                          │ resource.id                                      │
 * │ sourceId                         │ performer[0].reference  (→ performer[0].display) │
 * │ timestamp                        │ effectiveDateTime (→ issued → period.start)      │
 * │ syndromeCode                     │ code.coding[0].code     (→ code.text)            │
 * │ location                         │ encounter.reference     (ID portion only)        │
 * │ reporterId                       │ subject.reference       (patient ID)             │
 * │ notes                            │ valueString → valueCodeableConcept → valueQty    │
 * │                                  │   → valueBoolean → note[0].text                 │
 * └──────────────────────────────────┴──────────────────────────────────────────────────┘
 *
 * Usage
 *   const { parseFhirObservation } = require('./fhirAdapter');
 *   const report = parseFhirObservation(fhirObservationObject);
 */

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Return the first element of an array, or undefined if empty / not an array.
 * @template T
 * @param {T[]} arr
 * @returns {T|undefined}
 */
function first(arr) {
  return Array.isArray(arr) && arr.length > 0 ? arr[0] : undefined;
}

/**
 * Extract the logical ID from a FHIR reference string.
 *
 * Examples:
 *   "Patient/12345"        → "12345"
 *   "urn:uuid:abc-def"     → "urn:uuid:abc-def"  (no slash → returned as-is)
 *   "12345"                → "12345"
 *
 * @param {string|undefined} reference
 * @returns {string|null}
 */
function extractRefId(reference) {
  if (!reference || typeof reference !== 'string') return null;
  const trimmed = reference.trim();
  const slashIdx = trimmed.lastIndexOf('/');
  return slashIdx >= 0 ? trimmed.slice(slashIdx + 1) || null : trimmed || null;
}

/**
 * Resolve the primary syndrome code from Observation.code.
 *
 * Priority:
 *   1. First coding.code  (e.g. LOINC / SNOMED code)
 *   2. First coding.display
 *   3. code.text          (human-readable fallback)
 *
 * @param {object} obs
 * @returns {string|null}
 */
function resolveCode(obs) {
  const code = obs.code;
  if (!code) return null;

  const coding = first(code.coding);
  if (coding) {
    if (coding.code)    return String(coding.code).trim();
    if (coding.display) return String(coding.display).trim();
  }

  return code.text ? String(code.text).trim() : null;
}

/**
 * Resolve the observation value to a human-readable string.
 *
 * FHIR value[x] polymorphism is handled in priority order:
 *   valueString          → direct text
 *   valueCodeableConcept → text → coding[0].display → coding[0].code
 *   valueQuantity        → "value unit"
 *   valueBoolean         → "true" / "false"
 *   valueInteger         → stringified
 *   note[0].text         → last-resort narrative
 *
 * @param {object} obs
 * @returns {string}  empty string if no value is resolvable
 */
function resolveValue(obs) {
  // valueString
  if (obs.valueString !== undefined && obs.valueString !== null) {
    return String(obs.valueString).trim();
  }

  // valueCodeableConcept
  if (obs.valueCodeableConcept) {
    const vcc    = obs.valueCodeableConcept;
    const vCoding = first(vcc.coding);
    if (vcc.text)          return String(vcc.text).trim();
    if (vCoding?.display)  return String(vCoding.display).trim();
    if (vCoding?.code)     return String(vCoding.code).trim();
  }

  // valueQuantity
  if (obs.valueQuantity) {
    const q = obs.valueQuantity;
    const unit = q.unit || q.code || '';
    return `${q.value ?? ''} ${unit}`.trim();
  }

  // valueBoolean
  if (obs.valueBoolean !== undefined) return String(obs.valueBoolean);

  // valueInteger
  if (obs.valueInteger !== undefined) return String(obs.valueInteger);

  // Narrative note fallback
  const note = first(obs.note);
  if (note?.text) return String(note.text).trim();

  return '';
}

/**
 * Resolve the effective timestamp from an Observation resource.
 *
 * Priority: effectiveDateTime → issued → effectivePeriod.start
 *
 * @param {object} obs
 * @returns {string|null}  ISO 8601 string as provided by FHIR, or null
 */
function resolveTimestamp(obs) {
  if (obs.effectiveDateTime) return String(obs.effectiveDateTime).trim();
  if (obs.issued)            return String(obs.issued).trim();
  if (obs.effectivePeriod?.start) return String(obs.effectivePeriod.start).trim();
  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a FHIR R4 Observation resource and return canonical report fields.
 *
 * @param {object} observation  FHIR R4 Observation resource (plain JS object)
 * @returns {{
 *   eventId:      string|null,
 *   sourceId:     string|null,
 *   timestamp:    string|null,
 *   syndromeCode: string|null,
 *   location:     string|null,
 *   reporterId:   string|null,
 *   notes:        string
 * }}
 * @throws {TypeError} if input is not a plain object
 * @throws {Error}     if resourceType is not "Observation"
 */
function parseFhirObservation(observation) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    throw new TypeError('Input must be a FHIR Observation object');
  }

  if (observation.resourceType !== 'Observation') {
    throw new Error(
      `Expected resourceType "Observation", got "${observation.resourceType ?? 'undefined'}"`,
    );
  }

  // ── reporterId – patient / subject of the observation ────────────────────
  const reporterId = extractRefId(observation.subject?.reference)
    ?? observation.subject?.display
    ?? null;

  // ── sourceId – performer who recorded the observation ────────────────────
  const performer = first(observation.performer ?? []);
  const sourceId  = performer
    ? (extractRefId(performer.reference) ?? performer.display ?? null)
    : null;

  // ── location – encounter context ──────────────────────────────────────────
  const location = observation.encounter?.reference
    ? extractRefId(observation.encounter.reference)
    : null;

  return {
    eventId:      observation.id    ? String(observation.id).trim()  : null,
    sourceId:     sourceId,
    timestamp:    resolveTimestamp(observation),
    syndromeCode: resolveCode(observation),
    location:     location,
    reporterId:   reporterId,
    notes:        resolveValue(observation),
  };
}

module.exports = { parseFhirObservation };
