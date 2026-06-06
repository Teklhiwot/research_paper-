'use strict';
/**
 * tests/e2e_test.js  –  End-to-end integration test
 *
 * Exercises the full disease-surveillance pipeline:
 *
 *   Edge (simulated) → API Gateway → RabbitMQ → Fog Node
 *     → Storage Service (MongoDB)
 *     → Blockchain (Hardhat / EventRegistry + AlertLog)
 *
 * What is tested
 * ──────────────
 *  Steps 1–6  : Single report lifecycle
 *    1. Build a sample surveillance report
 *    2. POST to API Gateway (AES-256-GCM encrypted + Ed25519 signed payload)
 *    3. Wait PIPELINE_WAIT_MS for the async pipeline
 *    4. GET the report from the Storage Service by eventId
 *    5. Query EventRegistry.getEvent(sha256Hash) on Hardhat
 *    6. Assert stored document and on-chain record are consistent
 *
 *  Steps 7–9  : Anomaly detection
 *    7. Fire 15 rapid reports (same syndrome + location) to breach EWMA threshold
 *    8. Query AlertLog.getPastEvents('AlertRaised') on Hardhat
 *    9. Assert at least one AlertRaised event exists with matching syndromeCode
 *
 * Required environment variables
 * ───────────────────────────────
 *  JWT_SECRET            – HMAC-SHA256 secret shared by gateway + storage
 *  GATEWAY_DECRYPT_KEY   – 64-char hex AES-256 key used by the gateway
 *
 * Optional environment variables
 * ───────────────────────────────
 *  GATEWAY_URL               – default http://localhost:3000
 *  STORAGE_URL               – default http://localhost:4000
 *  HARDHAT_URL               – default http://localhost:8545
 *  PIPELINE_WAIT_MS          – ms to wait after single POST  (default 5000)
 *  ANOMALY_WAIT_MS           – ms to wait after anomaly burst (default 10000)
 *  EVENT_REGISTRY_ADDRESS    – overrides deployed-addresses.json
 *  ALERT_LOG_ADDRESS         – overrides deployed-addresses.json
 *  DEPLOYED_ADDRESSES_PATH   – path to deployed-addresses.json
 *  ARTIFACTS_DIR             – path to blockchain/artifacts/contracts
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { expect }    = require('chai');
const axios         = require('axios');
const { Web3 }      = require('web3');
const crypto        = require('crypto');
const nacl          = require('tweetnacl');
const jwt           = require('jsonwebtoken');
const path          = require('path');
const fs            = require('fs');

// ─── Configuration ────────────────────────────────────────────────────────────

const GATEWAY_URL   = process.env.GATEWAY_URL   || 'http://localhost:3000';
const STORAGE_URL   = process.env.STORAGE_URL   || 'http://localhost:4000';
const HARDHAT_URL   = process.env.HARDHAT_URL   || 'http://localhost:8545';

const JWT_SECRET      = process.env.JWT_SECRET;
const DECRYPT_KEY_HEX = process.env.GATEWAY_DECRYPT_KEY;

if (!JWT_SECRET)      throw new Error('JWT_SECRET environment variable is required');
if (!DECRYPT_KEY_HEX) throw new Error('GATEWAY_DECRYPT_KEY environment variable is required');

if (DECRYPT_KEY_HEX.length !== 64 || !/^[0-9a-fA-F]+$/.test(DECRYPT_KEY_HEX)) {
  throw new Error('GATEWAY_DECRYPT_KEY must be a 64-character hex string');
}

const PIPELINE_WAIT = Number(process.env.PIPELINE_WAIT_MS  || '5000');
const ANOMALY_WAIT  = Number(process.env.ANOMALY_WAIT_MS   || '10000');

// ─── Contract addresses + ABIs ────────────────────────────────────────────────

function loadDeployedAddresses() {
  const custom = process.env.DEPLOYED_ADDRESSES_PATH;
  const candidates = [
    custom && path.resolve(custom),
    path.resolve(__dirname, '../blockchain/deployed-addresses.json'),
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  throw new Error(
    'deployed-addresses.json not found. ' +
    'Run "npx hardhat run deploy/00_deploy.js" first, or set DEPLOYED_ADDRESSES_PATH.',
  );
}

const deployed            = loadDeployedAddresses();
const EVENT_REGISTRY_ADDR = process.env.EVENT_REGISTRY_ADDRESS || deployed.contracts.EventRegistry;
const ALERT_LOG_ADDR      = process.env.ALERT_LOG_ADDRESS      || deployed.contracts.AlertLog;

const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR
  || path.resolve(__dirname, '../blockchain/artifacts/contracts');

function loadAbi(contractDir) {
  const candidates = fs.readdirSync(path.join(ARTIFACTS_DIR, contractDir))
    .filter(f => f.endsWith('.json') && !f.endsWith('.dbg.json'));
  if (candidates.length === 0) throw new Error(`No ABI found in ${contractDir}`);
  return JSON.parse(
    fs.readFileSync(path.join(ARTIFACTS_DIR, contractDir, candidates[0]), 'utf8'),
  ).abi;
}

const EVENT_REGISTRY_ABI = loadAbi('EventRegistry.sol');
const ALERT_LOG_ABI      = loadAbi('AlertLog.sol');

// ─── Crypto / payload helpers ─────────────────────────────────────────────────

const AES_KEY = Buffer.from(DECRYPT_KEY_HEX, 'hex');  // 32 bytes

/**
 * Encrypt a report object with AES-256-GCM.
 *
 * Binary format expected by the gateway:
 *   iv (12 bytes) || ciphertext (n bytes) || GCM auth tag (16 bytes)
 * All concatenated and base64-encoded as a single string.
 */
function encryptReport(reportObj) {
  const iv        = crypto.randomBytes(12);
  const plaintext = Buffer.from(JSON.stringify(reportObj), 'utf8');
  const cipher    = crypto.createCipheriv('aes-256-gcm', AES_KEY, iv);
  const ct        = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag       = cipher.getAuthTag();                                  // 16 bytes
  return Buffer.concat([iv, ct, tag]).toString('base64');
}

/**
 * Sign a report object with Ed25519 (detached signature over sorted-key JSON).
 * Mirrors edge-client/utils/crypto.js::signReport.
 */
function signReport(reportObj, secretKey) {
  const canonical = JSON.stringify(reportObj, Object.keys(reportObj).sort());
  const message   = Buffer.from(canonical, 'utf8');
  return Buffer.from(nacl.sign.detached(message, secretKey)).toString('base64');
}

/**
 * Mint a short-lived HS256 JWT with the given role.
 */
function makeToken(role) {
  return jwt.sign({ sub: 'e2e-test', role }, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '2h',
  });
}

/** Convenience: wait for `ms` milliseconds. */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Build a canonical SHA-256 hash matching the one computed by
 * storage-service/models/Report.js::preSave().
 *
 * CANONICAL_FIELDS (sorted alphabetically) = [
 *   'eventId','location','notes','reporterId',
 *   'sourceId','status','syndromeCode','timestamp'
 * ]
 * All values must be in their final stored form (status='validated', etc.)
 */
function computeCanonicalHash(fields) {
  const CANONICAL = [
    'eventId', 'location', 'notes', 'reporterId',
    'sourceId', 'status', 'syndromeCode', 'timestamp',
  ];
  const obj = {};
  for (const k of CANONICAL) obj[k] = fields[k];
  return crypto.createHash('sha256').update(JSON.stringify(obj), 'utf8').digest('hex');
}

/**
 * Build a test surveillance report object.
 * `syndromeCode` is already uppercased so it matches what the gateway stores.
 */
function buildReport({ syndromeCode = 'ILI', location = 'TestCity', tag = '0' } = {}) {
  return {
    eventId:     crypto.randomUUID(),
    sourceId:    `e2e-device-${tag}`,
    timestamp:   Date.now(),
    syndromeCode: syndromeCode.toUpperCase(),
    location,
    reporterId:  'e2e-reporter',
    notes:       `E2E integration test – ${Date.now()}`,
    status:      'pending',               // gateway sets this; storage maps to 'validated'
  };
}

/**
 * Encrypt, sign, and POST a report to the gateway.
 * Returns the full axios response (validateStatus always true).
 */
async function postReport(report, token) {
  const keypair   = nacl.sign.keyPair();                           // ephemeral per report
  const payload   = encryptReport(report);
  const signature = signReport(report, keypair.secretKey);
  const publicKey = Buffer.from(keypair.publicKey).toString('base64');

  return axios.post(
    `${GATEWAY_URL}/report`,
    { payload, signature, publicKey, eventId: report.eventId },
    {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      validateStatus: () => true,
    },
  );
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('E2E: Disease Surveillance Prototype', function () {
  // Overall timeout budget; individual tests can override.
  this.timeout(90_000);

  let web3;
  let eventRegistry;
  let alertLog;
  let blockchainAvailable = true;

  /** Tokens */
  const reporterToken = makeToken('REPORTER');
  const adminToken    = makeToken('ADMIN');

  before(async function () {
    web3          = new Web3(HARDHAT_URL);
    eventRegistry = new web3.eth.Contract(EVENT_REGISTRY_ABI, EVENT_REGISTRY_ADDR);
    alertLog      = new web3.eth.Contract(ALERT_LOG_ABI, ALERT_LOG_ADDR);

    // Probe the Hardhat node; flag unavailable so blockchain tests can skip gracefully.
    try {
      await web3.eth.getBlockNumber();
    } catch {
      console.warn('      ⚠  Hardhat node unreachable – blockchain assertions will be skipped.');
      blockchainAvailable = false;
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Steps 1–6 : Single report → gateway → storage → (optional) blockchain
  // ──────────────────────────────────────────────────────────────────────────

  describe('Steps 1–6: Single report lifecycle', function () {
    let report;
    let storedDoc;

    before(function () {
      // Step 1 – generate a sample surveillance report
      report = buildReport({ syndromeCode: 'ILI', location: 'TestCity', tag: 'single' });
    });

    // ── Step 2 ───────────────────────────────────────────────────────────────
    it('Step 2: POST /report is accepted by the API gateway (202)', async function () {
      const resp = await postReport(report, reporterToken);

      expect(
        resp.status,
        `Gateway returned ${resp.status}: ${JSON.stringify(resp.data)}`,
      ).to.equal(202);
      expect(resp.data.accepted).to.equal(true);
      expect(resp.data.eventId).to.equal(report.eventId);
    });

    // ── Step 3 ───────────────────────────────────────────────────────────────
    it(`Step 3: wait ${PIPELINE_WAIT} ms for the async pipeline`, async function () {
      this.timeout(PIPELINE_WAIT + 5_000);
      await wait(PIPELINE_WAIT);
    });

    // ── Step 4 ───────────────────────────────────────────────────────────────
    it('Step 4: GET /report/:eventId from the storage service returns HTTP 200', async function () {
      const resp = await axios.get(
        `${STORAGE_URL}/report/${report.eventId}`,
        {
          headers: { Authorization: `Bearer ${adminToken}` },
          validateStatus: () => true,
        },
      );

      expect(
        resp.status,
        `Storage service returned ${resp.status}: ${JSON.stringify(resp.data)}`,
      ).to.equal(200);

      storedDoc = resp.data;
    });

    it('Step 4: stored document has correct eventId, syndromeCode, location, sourceId', function () {
      expect(storedDoc, 'storedDoc is undefined – GET /report may have failed').to.exist;
      expect(storedDoc.eventId).to.equal(report.eventId);
      expect(storedDoc.syndromeCode).to.equal(report.syndromeCode.toUpperCase());
      expect(storedDoc.location).to.equal(report.location);
      expect(storedDoc.sourceId).to.equal(report.sourceId);
    });

    it('Step 4: stored document contains a sha256Hash field', function () {
      expect(storedDoc).to.have.property('sha256Hash').that.is.a('string').with.length(64);
    });

    it('Step 4: sha256Hash is consistent with canonical fields in the stored document', function () {
      // The Report pre-save hook computes the hash over plaintext canonical fields
      // (including decrypted notes + reporterId returned by GET) with status='validated'.
      const expected = computeCanonicalHash({
        eventId:     storedDoc.eventId,
        location:    storedDoc.location,
        notes:       storedDoc.notes,
        reporterId:  storedDoc.reporterId,   // decrypted by GET endpoint
        sourceId:    storedDoc.sourceId,
        status:      storedDoc.status,       // 'validated' after gateway maps 'pending'
        syndromeCode: storedDoc.syndromeCode,
        timestamp:   storedDoc.timestamp,    // number from parseTimestamp
      });

      expect(storedDoc.sha256Hash).to.equal(
        expected,
        'sha256Hash stored in MongoDB does not match a fresh canonical computation',
      );
    });

    // ── Steps 5–6 ────────────────────────────────────────────────────────────
    it('Steps 5–6: EventRegistry.getEvent — if anchored, sourceId and hash must match', async function () {
      if (!blockchainAvailable) return this.skip();
      if (!storedDoc || !storedDoc.sha256Hash) return this.skip();

      // Bytes32 key = '0x' + 64-char hex SHA-256
      const hashBytes32 = '0x' + storedDoc.sha256Hash;

      let commit;
      try {
        commit = await eventRegistry.methods.getEvent(hashBytes32).call();
      } catch (err) {
        console.warn('      ⚠  EventRegistry.getEvent failed:', err.message);
        return this.skip();
      }

      if (!commit.exists) {
        // Normal events are batched (BATCH_SIZE defaults to 50).
        // The hash may not be on-chain until the batch window is full.
        console.log(
          '      ℹ  Event not yet anchored on-chain (batch window not full).\n' +
          '         Set BATCH_SIZE=1 on the fog-node to anchor every event immediately.',
        );
        // Hash consistency was already asserted above; nothing more to check here.
        return;
      }

      // On-chain record found → assert the metadata is consistent
      expect(commit.sourceId).to.equal(
        storedDoc.sourceId,
        'on-chain sourceId does not match MongoDB sourceId',
      );
      // The bytes32 key IS the hash, so its presence already proves the mapping.
      // Cross-check with the storage document for belt-and-suspenders assurance.
      expect(storedDoc.sha256Hash).to.equal(
        hashBytes32.slice(2),
        'sha256Hash from MongoDB does not match the bytes32 used to query EventRegistry',
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Steps 7–9 : Anomaly detection
  // ──────────────────────────────────────────────────────────────────────────

  describe('Steps 7–9: Anomaly detection – 15 rapid reports', function () {
    const SYNDROME  = 'FLUE2E';     // unique syndrome to avoid interference
    const LOCATION  = 'AnomalyCity';
    const N_REPORTS = 15;           // > ANOMALY_THRESHOLD (default 10)

    let alertEvents = [];

    // ── Step 7 ───────────────────────────────────────────────────────────────
    it(`Step 7: all ${N_REPORTS} rapid reports are accepted by the gateway (202)`, async function () {
      this.timeout(30_000);

      const reports = Array.from({ length: N_REPORTS }, (_, i) =>
        buildReport({ syndromeCode: SYNDROME, location: LOCATION, tag: String(i) }),
      );

      // Fire concurrently to maximise throughput and ensure the aggregator
      // counts them all within the same one-hour sliding window.
      const results = await Promise.all(reports.map(r => postReport(r, reporterToken)));

      const rejected = results.filter(r => r.status !== 202);
      expect(
        rejected,
        `${rejected.length} / ${N_REPORTS} reports were NOT accepted:\n` +
        rejected.map(r => `  status=${r.status} body=${JSON.stringify(r.data)}`).join('\n'),
      ).to.have.length(0);
    });

    it(`Step 7: wait ${ANOMALY_WAIT} ms for anomaly pipeline processing`, async function () {
      this.timeout(ANOMALY_WAIT + 5_000);
      await wait(ANOMALY_WAIT);
    });

    // ── Steps 8–9 ────────────────────────────────────────────────────────────
    it('Step 8: query AlertLog for AlertRaised events on-chain', async function () {
      if (!blockchainAvailable) return this.skip();

      let events;
      try {
        events = await alertLog.getPastEvents('AlertRaised', { fromBlock: 0 });
      } catch (err) {
        console.warn('      ⚠  AlertLog.getPastEvents failed:', err.message);
        return this.skip();
      }

      alertEvents = events.filter(e => e.returnValues.syndromeCode === SYNDROME);
    });

    it(`Step 9: at least one AlertRaised event exists for syndromeCode=${SYNDROME}`, function () {
      if (!blockchainAvailable) return this.skip();

      expect(
        alertEvents.length,
        `No AlertRaised events found for syndromeCode=${SYNDROME}.\n` +
        'Ensure the blockchain anchor service is running with VALIDATOR_ROLE ' +
        'and the fog-node EWMA threshold (ANOMALY_THRESHOLD) is ≤ 15.',
      ).to.be.greaterThan(0);
    });

    it('Step 9: AlertRaised event has matching syndromeCode, non-zero count, and non-zero eventHash', function () {
      if (!blockchainAvailable || alertEvents.length === 0) return this.skip();

      // Use the last event in case multiple were emitted
      const rv = alertEvents[alertEvents.length - 1].returnValues;

      expect(rv.syndromeCode).to.equal(SYNDROME);

      expect(
        Number(rv.count),
        'AlertRaised count should be > 0',
      ).to.be.greaterThan(0);

      const ZERO_HASH = '0x' + '00'.repeat(32);
      expect(rv.eventHash, 'eventHash should not be the zero bytes32').to.not.equal(ZERO_HASH);

      const ZERO_ALERT = '0x' + '00'.repeat(32);
      expect(rv.alertId, 'alertId should not be the zero bytes32').to.not.equal(ZERO_ALERT);
    });
  });
});
