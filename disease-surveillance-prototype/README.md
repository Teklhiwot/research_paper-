# Disease Surveillance Prototype

A multi-layer prototype for privacy-preserving disease surveillance using edge clients, an API gateway, fog-node analytics, secure storage, and blockchain-based event logging.

## Project Structure

- **edge-client/**: React Native + Expo mobile client
- **api-gateway/**: Node.js/Express interoperability layer
- **fog-node/**: Python/FastAPI analytics and validation services
- **storage-service/**: MongoDB/Mongoose service with encryption support
- **blockchain/**: Solidity smart contracts and Hardhat configuration
- **docker-compose.yml**: Local multi-service orchestration

## Components

### Edge Client
Collects health-related data from users and submits it securely to backend services.

### API Gateway
Acts as the entry point for client requests and routes data between services.

### Fog Node
Performs validation, anomaly detection, and local analytics on incoming surveillance data.

### Storage Service
Stores encrypted data and manages persistence with MongoDB.

### Blockchain Layer
Records important events and alerts on-chain for integrity and auditability.

## Getting Started

### Prerequisites
- Node.js
- npm
- Python 3.10+
- Docker and Docker Compose
- MongoDB
- Hardhat

### Run with Docker Compose
```bash
cd disease-surveillance-prototype
docker compose up --build
```

### Development Notes
Each service can also be started independently from its own directory after installing dependencies.

## Status
This repository currently contains scaffolded services and starter smart contracts for further development.
