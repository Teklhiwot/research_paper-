// deploy/00_deploy.js
// Standard Hardhat 3.x deployment script (ethers v6).
// Usage:
//   npx hardhat run deploy/00_deploy.js                  (hardhatMainnet)
//   npx hardhat run deploy/00_deploy.js --network sepolia
//
// Required env vars (see .env):
//   FOG_ADDRESS – Ethereum address of the fog node that receives VALIDATOR_ROLE

import "dotenv/config";
import { network } from "hardhat";
import { writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ── Validate environment ────────────────────────────────────────────────────

const fogAddress = process.env.FOG_ADDRESS;
if (!fogAddress) {
  throw new Error("FOG_ADDRESS environment variable is required");
}

// ── Connect to network (Hardhat 3.x API) ───────────────────────────────────

const { ethers } = await network.create();

if (!ethers.isAddress(fogAddress)) {
  throw new Error(`FOG_ADDRESS is not a valid Ethereum address: ${fogAddress}`);
}

const [deployer] = await ethers.getSigners();
console.log("Deployer :", deployer.address);
console.log("Fog node :", fogAddress);
console.log("");

// ── Deploy EventRegistry ────────────────────────────────────────────────────

const EventRegistryFactory = await ethers.getContractFactory("EventRegistry");
const eventRegistry        = await EventRegistryFactory.deploy(deployer.address);
await eventRegistry.waitForDeployment();
const eventRegistryAddress = await eventRegistry.getAddress();
console.log("EventRegistry  →", eventRegistryAddress);

// ── Deploy AlertLog ─────────────────────────────────────────────────────────

const AlertLogFactory = await ethers.getContractFactory("AlertLog");
const alertLog        = await AlertLogFactory.deploy(deployer.address);
await alertLog.waitForDeployment();
const alertLogAddress = await alertLog.getAddress();
console.log("AlertLog       →", alertLogAddress);

// ── Deploy RevocationLog ────────────────────────────────────────────────────

const RevocationLogFactory = await ethers.getContractFactory("RevocationLog");
const revocationLog        = await RevocationLogFactory.deploy(deployer.address);
await revocationLog.waitForDeployment();
const revocationLogAddress = await revocationLog.getAddress();
console.log("RevocationLog  →", revocationLogAddress);
console.log("");

// ── Grant VALIDATOR_ROLE to fog node on all three contracts ─────────────────
// VALIDATOR_ROLE is already held by the deployer (set in each constructor).
// Here we additionally grant it to the dedicated fog-node address so it can
// call registerEvent / raiseAlert without using the deployer key in production.

const VALIDATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("VALIDATOR_ROLE"));

for (const [label, contract] of [
  ["EventRegistry",  eventRegistry],
  ["AlertLog",       alertLog],
  ["RevocationLog",  revocationLog],
]) {
  const tx = await contract.grantRole(VALIDATOR_ROLE, fogAddress);
  await tx.wait();
  console.log(`VALIDATOR_ROLE granted on ${label} → ${fogAddress}`);
}
console.log("");

// ── Confirm deployer holds ADMIN_ROLE (granted by each constructor) ─────────

const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));

for (const [label, contract] of [
  ["EventRegistry",  eventRegistry],
  ["AlertLog",       alertLog],
  ["RevocationLog",  revocationLog],
]) {
  const ok = await contract.hasRole(ADMIN_ROLE, deployer.address);
  console.log(`ADMIN_ROLE on ${label} (deployer): ${ok}`);
}
console.log("");

// ── Save deployment manifest ────────────────────────────────────────────────

const { chainId } = await ethers.provider.getNetwork();

const manifest = {
  chainId:     Number(chainId),
  deployedAt:  new Date().toISOString(),
  deployer:    deployer.address,
  fogAddress,
  contracts: {
    EventRegistry:  eventRegistryAddress,
    AlertLog:       alertLogAddress,
    RevocationLog:  revocationLogAddress,
  },
};

const outPath = resolve(__dirname, "../deployed-addresses.json");
writeFileSync(outPath, JSON.stringify(manifest, null, 2));
console.log("Deployment manifest written to:", outPath);
