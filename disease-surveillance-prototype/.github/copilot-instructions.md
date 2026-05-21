# Copilot Agent Constraints

## Architecture
- Three-tier: Edge (React Native/Expo) → Gateway (Node/Express) → Fog (Python/FastAPI) → Storage (MongoDB/Mongoose) → Blockchain (Solidity/Hardhat)
- Message queue: RabbitMQ (NOT Kafka)
- Cache: Redis for deduplication
- Encryption: AES-256-GCM via Node.js crypto module
- Blockchain: Local Hardhat network (NOT Besu)

## Code Standards
- Edge: React Native with Expo SDK 50+, AsyncStorage for offline queue
- Gateway: Express 4+, validate JWT + normalize to canonical JSON schema
- Fog: FastAPI, Pydantic models, aio-pika for RabbitMQ, redis-py
- Storage: Mongoose 7+, MongoDB 6+, encrypt sensitive fields before save
- Contracts: Solidity ^0.8.19, OpenZeppelin AccessControl, emit events for all state changes
- NEVER store raw patient data on-chain. Only SHA-256 hashes and metadata.
- All Docker services must include health checks
