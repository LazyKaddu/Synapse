# Synapse MMO - High-Performance Scalable Backend

A distributed, ultra-low-latency 2D Massively Multiplayer Online (MMO) backend written in Rust. Designed to support thousands of concurrent players in an infinite procedurally generated universe with 60 FPS client interpolation, proximity WebRTC spatial audio, and cross-region telephony.

---

## 🏛️ Architecture Overview

The backend is built as a modular, high-throughput **Cargo Workspace** dividing workloads into distinct Kubernetes services and shared crates:

```
Backend/
├── Cargo.toml                       # Root workspace configuration with optimized profiles
├── rust-toolchain.toml              # Pinned Rust toolchain (stable)
├── .cargo/
│   └── config.toml                  # Compiler flags and alias shortcuts (c, t, b, lint)
├── config/                          # Multi-environment configuration (config-rs)
│   ├── default.toml                 # Shared defaults (ports, tick rate, chunk size)
│   ├── development.toml             # Local development overrides
│   └── production.toml              # Production cluster overrides
├── migrations/                      # PostgreSQL migrations (SQLx format)
│   ├── 0001_init_account_security.sql
│   ├── 0002_init_characters_spatial.sql
│   └── 0003_init_inventory_assets.sql
├── crates/                          # Shared Domain & Infrastructure Libraries
│   ├── synapse-common/              # Errors, configuration loader, telemetry, metrics, JWT & auth
│   │   └── tests/                   # Dedicated test suite (auth_tests, config_tests, integration_auth_flow)
│   ├── synapse-protocol/            # Binary 60FPS codecs (OpCodes 0x01, 0x02, 0x10, 0x11, 0x12), JSON social DTOs
│   │   └── tests/                   # Dedicated test suite (binary_tests, social_tests, rest_tests, integration_flow)
│   ├── synapse-spatial/             # 1000x1000 chunking, 3x3 AOI, grid diffing, OpenSimplex terrain, audio culling
│   │   └── tests/                   # Dedicated test suite (coord_tests, aoi_tests, culling_tests, terrain_tests, integration_flow)
│   ├── synapse-storage/             # DbRouter (Read/Write/Shard routing), PgBouncer pools, Repositories, Redis Hot/Warm caching
│   │   └── tests/                   # Dedicated test suite (router_tests)
│   └── synapse-livekit/             # LiveKit SFU orchestrator, lazy room lifecycle, token minting, mega-crowd downgrade
│       └── tests/                   # Dedicated test suite (orchestrator_tests, token_tests)
├── services/                        # Specialized Microservices & Workloads
│   ├── gateway/                     # Stateless REST API (auth, character management, boarding pass / handoff)
│   ├── game-server/                 # Stateful TCP/WebSocket Engine (10Hz tick, hot RAM spatial index, WebRTC audio)
│   │   └── tests/                   # Dedicated test suite (grid_tests)
│   └── worker/                      # 3-minute Cold State periodic flusher, session cleaner & Ghost NPC runner
├── docker/                          # Containerization & Infrastructure
│   ├── Dockerfile.gateway           # Multi-stage Dockerfile for REST Gateway
│   ├── Dockerfile.game-server       # Multi-stage Dockerfile for Spatial Game Server
│   ├── Dockerfile.worker            # Multi-stage Dockerfile for Worker Daemon
│   └── pgbouncer/
│       └── pgbouncer.ini            # PgBouncer connection pooling configuration
├── k8s/                             # Kubernetes Deployment Manifests
│   ├── gateway-deployment.yaml      # Elastic stateless deployment
│   ├── gameserver-statefulset.yaml  # StatefulSet with preStop graceful drain hook
│   └── keda-autoscaling.yaml        # KEDA Prometheus autoscaler on active_websocket_connections
├── docker-compose.yml               # Local multi-service dev environment (Postgres, PgBouncer, Redis, LiveKit)
└── .env.example                     # Environment variables template
```

---

## ⚡ The Three-Tiered State Pipeline

1. **Hot State (In-Memory RAM):**
   - Managed via sharded concurrent hash maps (`DashMap`) inside `game-server`.
   - Stores instant (X, Y) coordinates for 10Hz binary broadcasting to nearby players in the 3x3 AOI grid.
2. **Warm State (Redis Hashes):**
   - Coordinates flushed every tick to Redis (`player:{shard}:{character_id}` and `chunk:{shard}:{chunk_x}_{chunk_y}`).
   - Shields the persistent database and protects against node panics.
3. **Cold State (PostgreSQL via PgBouncer):**
   - The permanent ACID source of truth.
   - Queried only upon login or server transfer.
   - Persisted on disconnect, graceful shutdown, or every 3 minutes by `worker`.

---

## 🌐 Network Protocol Specifications

### 1. Data Plane: High-Frequency Binary WebSockets (60 FPS)
All packets begin with a 1-byte OpCode:
* **0x01 (Client -> Server):** Player Movement (9 bytes: `[0x01: u8][Pos_X: f32 LE][Pos_Y: f32 LE]`)
* **0x02 (Client -> Server):** Combat/Action (5 bytes: `[0x02: u8][Action_ID: u32 LE]`)
* **0x10 (Server -> Client):** Neighbor Movement (13 bytes: `[0x10: u8][Player_ID: u32 LE][Pos_X: f32 LE][Pos_Y: f32 LE]`)
* **0x11 (Server -> Client):** Entity Spawn (21 bytes: `[0x11: u8][Entity_ID: u32 LE][Type: u8][Pos_X: f32 LE][Pos_Y: f32 LE][Health: f32 LE]`)
* **0x12 (Server -> Client):** Entity Despawn (5 bytes: `[0x12: u8][Entity_ID: u32 LE]`)

### 2. Social Plane: JSON WebSockets
* `VOICE_JOIN`: Dynamic LiveKit SFU room credentials.
* `VOICE_SET_TRACKS`: Top-50 culled proximity audio tracks with hysteresis buffer.
* `CHAT_MSG`: Spatial or global text messages.
* `PHONE_RING`: Cross-region telephony routing via Global Redis Pub/Sub.
* `SERVER_RESTART`: Triggered during Kubernetes graceful scale-down / preStop hook.

---

## 🚀 Getting Started

### Prerequisites
* Rust 1.82+ (`rustup toolchain install stable`)
* Docker & Docker Compose
* PostgreSQL client (`psql`) & Redis CLI

### Local Infrastructure Setup
```bash
# 1. Start Postgres, PgBouncer, Redis, and LiveKit
docker compose up -d

# 2. Verify containers are healthy
docker compose ps
```

### Running the Services
```bash
# Run API Gateway
cargo run -p gateway

# Run Spatial Game Server
cargo run -p game-server

# Run Background Worker Daemon
cargo run -p worker
```

---

## 🛠️ Cargo Workspace Aliases

Pre-configured in `.cargo/config.toml`:
* `cargo c` -> `cargo check --workspace`
* `cargo t` -> `cargo test --workspace`
* `cargo b` -> `cargo build --workspace`
* `cargo lint` -> `cargo clippy --workspace --all-targets -- -D warnings`
* `cargo fmt-check` -> `cargo fmt --all -- --check`
