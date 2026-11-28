# Synapse: Infinite Spatial MMO

<div align="center">

![Synapse Banner](Frontend/public/favicon.svg)

**An ultra-low-latency, browser-native 2D spatial MMO engine powered by Rust, PixiJS, WebGL, WebSockets, and WebRTC.**

[![Rust](https://img.shields.io/badge/Rust-1.82+-dea584.svg?style=flat-square&logo=rust)](https://www.rust-lang.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6+-3178c6.svg?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg?style=flat-square&logo=react)](https://react.dev/)
[![PixiJS](https://img.shields.io/badge/PixiJS-8.0+-e72264.svg?style=flat-square&logo=pixijs)](https://pixijs.com/)
[![Vite](https://img.shields.io/badge/Vite-6.0+-646cff.svg?style=flat-square&logo=vite)](https://vitejs.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-4169e1.svg?style=flat-square&logo=postgresql)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7.2+-dc382d.svg?style=flat-square&logo=redis)](https://redis.io/)
[![LiveKit](https://img.shields.io/badge/LiveKit-SFU-00bbff.svg?style=flat-square)](https://livekit.io/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ed.svg?style=flat-square&logo=docker)](https://www.docker.com/)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-K8s-326ce5.svg?style=flat-square&logo=kubernetes)](https://kubernetes.io/)

[Architecture Overview](#system-architecture) •
[Key Features](#core-features--mechanics) •
[Network Protocol](#network-protocol-specifications) •
[Controls](#in-game-controls--shortcuts) •
[Quickstart](#getting-started) •
[Testing](#testing--verification)

</div>

---

## The Product Vision

**Synapse** is a high-concurrency, horizontally scalable spatial MMO engine disguised as a 2D RPG. Designed to rival the social presence of platforms like VRChat or Gather.town combined with the mechanical depth of a traditional RPG, Synapse drops thousands of concurrent players into an infinitely expanding, procedurally generated universe running at a flawless **60 FPS directly inside modern web browsers** without requiring a single map file download. 

### Core Pillars

* **Zero-Bandwidth Infinite Sandbox:** The world takes 0 bytes of disk storage on servers and requires 0 bandwidth to transmit terrain. The Rust server and PixiJS client execute identical deterministic multi-octave OpenSimplex noise and Voronoi math on shared seeds to generate biomes, rivers, dense forests, and villages on the fly.
* **Binary-First Low-Latency Networking:** Movement bypasses browser `JSON.parse()` bottlenecks completely. Position frames are packed into raw 9-byte upstream and 13-byte downstream C-style binary byte arrays, enabling clients to ingest thousands of neighbor updates per second with zero JavaScript garbage collection stutter.
* **WebRTC Spatial Proximity Voice & Global Phone Network:** Full 3D spatialized audio with dynamic Euclidean distance attenuation and stereo panning. When players venture to different regions or shards, they pull out an in-game phone to dial friends via a peer-to-peer WebRTC tunnel routed through a global Redis presence exchange.
* **Three-Tiered Resilient State Pipeline:** Hot in-memory RAM spatial index (`DashMap`) handles 10Hz binary broadcasting; Warm Redis hashes capture periodic write-back state to survive worker crashes; Cold PostgreSQL via PgBouncer safeguards permanent ACID persistence.
* **Creative Stacked Prefabs & Sandbox Tools:** An in-game building editor with multi-layer depth indexing allows players to design, trim, serialize, and stamp structures into the persistent world.
* **Instant Collision-Safe Teleporter:** Jump anywhere across the infinite realm using tile coordinates, online friends tracking, or nearest procedural landmark discovery with automatic anti-stuck safe spawn resolution.

---

## System Architecture

Synapse decouples high-frequency movement updates (TCP/Binary WebSockets) from heavy media streaming (UDP/WebRTC) and stateless HTTP requests.

---

## The Three-Tiered State Pipeline

| Tier | Technology | Lifetime & Update Frequency | Purpose |
| :--- | :--- | :--- | :--- |
| **Hot State** | In-Memory Rust RAM (`DashMap`) | Sub-millisecond (10Hz tick loop) | Stores active (X, Y) positions, 3x3 AOI subscriptions, and LiveKit voice room tokens for zero-overhead broadcasting. |
| **Warm State** | Redis Hashes (`player:{shard}:{id}`) | Flushed every 1 second (10 ticks) | Write-back cache preventing data loss from unexpected server restarts and powering the inter-region presence phonebook. |
| **Cold State** | PostgreSQL 16+ via PgBouncer | Flushed on disconnect / 60s background batch | Permanent ACID source of truth. Queried strictly on initial login or shard migration. |

---

## Network Protocol Specifications

Synapse uses a dual-plane WebSocket connection over a single socket port:
* **Binary ArrayBuffers** for high-frequency 60 FPS spatial telemetry.
* **JSON Text Frames** for low-frequency social events, chats, friend requests, and WebRTC signaling.

### 1. Data Plane: High-Frequency Binary Protocol

All binary packets begin with a 1-byte `OpCode` (UInt8):

#### Upstream Packets (Client $\rightarrow$ Server)

| OpCode | Name | Payload Size | Wire Format (Little-Endian) |
| :---: | :--- | :---: | :--- |
| `0x01` | `CLIENT_MOVEMENT` | 9 Bytes | `[0x01: u8][Pos_X: f32][Pos_Y: f32]` |
| `0x02` | `CLIENT_ACTION` | 5 Bytes | `[0x02: u8][Action_ID: u32]` |

#### Downstream Packets (Server $\rightarrow$ Client)

| OpCode | Name | Payload Size | Wire Format (Little-Endian) |
| :---: | :--- | :---: | :--- |
| `0x10` | `NEIGHBOR_MOVEMENT` | 13 Bytes | `[0x10: u8][Player_ID: u32][Pos_X: f32][Pos_Y: f32]` |
| `0x11` | `ENTITY_SPAWN` | 21 Bytes | `[0x11: u8][Entity_ID: u32][Type: u8][Pos_X: f32][Pos_Y: f32][Health: f32]` |
| `0x12` | `ENTITY_DESPAWN` | 5 Bytes | `[0x12: u8][Entity_ID: u32]` |

### 2. Social Plane: JSON WebSocket Messages

Messages are tagged with a `"type"` discriminator:

* `VOICE_JOIN`: Dynamic LiveKit SFU credentials minted for the player's current spatial chunk.
* `VOICE_SET_TRACKS`: Top-50 nearest audio tracks filtered by the Rust `AudioCuller` with a hysteresis buffer.
* `CHAT_MSG`: Spatial local or global chat broadcast across AOI chunk subscribers.
* `PHONE_RING` & `PHONE_ANSWER`: Inter-region 1-on-1 telephony tunnel via global Redis Pub/Sub topic routing.
* `FRIEND_REQUEST_*` & `FRIEND_LIST_SYNC`: Real-time relationship management and status synchronization.
* `GROUP_*`: Multi-user group chat creation, invitation, and group messaging.
* `SERVER_RESTART`: Graceful Kubernetes pod evacuation warning directing clients to reconnect with a new boarding pass.

### 3. Control Plane: Stateless REST API

* `POST /api/v1/auth/login` – Account authentication returning session JWT.
* `GET /api/v1/characters` – Character profile list with spatial chunk coordinates.
* `POST /api/v1/world/join` – Generates a cryptographically signed, short-lived **Boarding Pass Ticket** for connecting to the regional game server.
* `GET|POST /api/v1/prefabs` – Cloud storage and retrieval for building prefabs.

---

## Core Features & Mechanics

### 1. Procedural Infinite Terrain & Biome Engine
* **5 Canonical Biomes:** `water_pond`, `meadow_plains`, `forest`, `desert_arid`, and `rocky_paver`.
* **Multi-Channel Noise Sampler:** Combines Continentalness, Temperature, Humidity, Erosion, Forest Density, and Tree Scatter.
* **Voronoi Village Generator:** Deterministic macro-Voronoi cell distribution placing authentic towns with central plazas, stone roads, residential houses, and thematic props (fountains, wells, market stalls).
* **Ecological Forest Clustering:** Multi-scale tree spread with core groves, glade clearings, and maturity hierarchies (large canopy, medium trees, small saplings, bushes).

### 2. Loose Viewport Culling & Zero-Allocation Sprite Pool
* **Inverse Camera:** Character stays locked at the screen center; the world container translates in the opposite direction with integer pixel rounding to eliminate subpixel tile shimmering.
* **Loose Culling Bounds:** Computes visible screen bounds plus an adaptive pre-fetch buffer margin (2 to 3 tiles) to guarantee zero pop-in during high-speed traversal.
* **Object Recycling (`SpritePool`):** The `new` keyword is strictly banned in the 60 FPS tick loop. Sprites are pre-allocated and checked out/in from pools, maintaining flat memory usage and preventing V8 GC micro-stutters.

### 3. Collision Engine & Safe Landing Solver
* **Discrete 2D AABB Hitboxes:** Evaluates bounding box overlaps against water bodies, tree trunks, and structural house walls.
* **Vector Slide Resolution:** Smooth sliding alongside collision surfaces along X and Y axes independently.
* **Anti-Stuck Safe Spawn Solver (`findSafeSpawn`):** Automatically searches in outward concentric spirals to relocate players to the nearest walkable tile if initial coordinates overlap solid obstacles.

### 4. Stacked Prefab World Builder
* **In-Game Editor (`[B]` Key):** Visual grid editor supporting asset extraction from 6 distinct tilesets.
* **Stacked Binary Codec:** Custom binary serialization supporting multi-layer Z-ordering:
  - $\text{worldZ} \le 0$: Blocks render beneath the player character.
  - $\text{worldZ} > 0$: Blocks render above the character for roofs, arches, and canopies.
* **Direct World Stamping:** Instant stamping with live transparency preview and coordinate snapping.

### 5. Multi-Mode Teleporter System
Accessible via **`[T]`** key or HUD button:
* **Coordinates Tab:** Accepts exact `(Tile X, Tile Y)` inputs with live conversion to world pixels and real-time biome walkability inspection.
* **Friends Tab:** Roster integrating live social presence; strictly enables 1-click teleportation to online friends with active positions.
* **Landmarks Tab:** Live radial searches using `WorldNoise` to identify the Nearest Village Plaza, Nearest Dense Forest, and Nearest Water Basin with real-time distance calculations.
* **Visual FX & Feedback:** Fullscreen cyan vignette flash pulse and glassmorphic HUD toast confirmation.

---

## In-Game Controls & Shortcuts

| Key / Input | Action | Context |
| :---: | :--- | :--- |
| <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> / <kbd>↑</kbd> <kbd>←</kbd> <kbd>↓</kbd> <kbd>→</kbd> | Move Character (8-directional) | Gameplay |
| <kbd>Shift</kbd> | Sprint (Double traversal speed) | Gameplay |
| <kbd>T</kbd> | Toggle Teleporter Modal (Waypoints) | Gameplay (Closes with <kbd>Esc</kbd>) |
| <kbd>B</kbd> | Toggle Building Editor Modal | Gameplay (Closes with <kbd>Esc</kbd>) |
| <kbd>Enter</kbd> / <kbd>Tab</kbd> | Toggle Social Chat & Friends Sidebar | Gameplay |
| <kbd>V</kbd> | Toggle Noise Engine Visualizer (Color vs Texture) | Gameplay |
| <kbd>Z</kbd> | Cycle Camera Zoom (1.0x $\rightarrow$ 0.5x $\rightarrow$ 0.25x) | Gameplay |
| <kbd>C</kbd> | Toggle Debug Culling & Hitbox Overlay | Gameplay |
| <kbd>I</kbd> | Toggle Inset Culling Inspector | Debug Overlay Active |
| <kbd>L</kbd> | Toggle Noise World Palette Legend | Gameplay |
| <kbd>[</kbd> / <kbd>]</kbd> | Adjust Prefab Stamping Anchor Z-Level | Active Prefab Placement |
| <kbd>Left Click</kbd> | Stamp Active Prefab in World | Active Prefab Placement |
| <kbd>Right Click</kbd> / <kbd>Esc</kbd> | Cancel Active Prefab Placement | Active Prefab Placement |

---

## Repository Structure

```
Synapse/
├── arch-docs/                       # Comprehensive architecture blueprints & specifications
│   ├── api_network_protocols_blueprint.txt
│   ├── database_architecture_blueprint.txt
│   ├── database_schemas.txt
│   ├── kubernetes_deployment_blueprint.txt
│   ├── mmo_backend_architecture_blueprint.txt
│   └── mmo_frontend_architecture_blueprint.txt
├── Backend/                         # Distributed Rust Workspace (1.82+)
│   ├── Cargo.toml                   # Root Cargo workspace manifest with lto & opt-level
│   ├── config/                      # Multi-environment configurations (default, dev, prod)
│   ├── crates/                      # Modular Domain & Infrastructure Crates
│   │   ├── synapse-common/          # Shared config, errors, JWT, and telemetry
│   │   ├── synapse-livekit/         # LiveKit WebRTC SFU orchestrator & token minter
│   │   ├── synapse-protocol/        # Binary 60FPS codecs & JSON social DTOs
│   │   ├── synapse-spatial/         # Chunking, 3x3 AOI, terrain noise, audio culler
│   │   └── synapse-storage/         # DbRouter, PostgreSQL repos, Redis warm cache
│   ├── docker/                      # Multi-stage Dockerfiles (gateway, game-server, worker, pgbouncer)
│   ├── docker-compose.yml           # Local multi-service infrastructure stack
│   ├── k8s/                         # Production Kubernetes manifests & KEDA autoscalers
│   ├── migrations/                  # SQLx migrations (Accounts, Characters, Prefabs, Social)
│   └── services/                    # Specialized Microservice Binaries
│       ├── game-server/             # Spatial engine (10Hz tick, Hot RAM SpatialGrid)
│       ├── gateway/                 # Stateless REST gateway (auth, boarding pass)
│       └── worker/                  # Periodic cold flusher & Ghost NPC daemon
├── Frontend/                        # Browser-Native Client (Vite + React 19 + PixiJS 8)
│   ├── index.html                   # Single-page HTML5 entrypoint
│   ├── package.json                 # Node dependencies & scripts
│   ├── src/
│   │   ├── api/                     # HTTP REST client bindings
│   │   ├── engine/                  # PixiJS WebGL core
│   │   │   ├── collision/           # AABB collision detection & sliding physics
│   │   │   ├── culling/             # Loose viewport culling & SpritePool
│   │   │   ├── prefab/              # StackedPrefabCodec, assetRegistry, builderGrid
│   │   │   ├── procedural/          # Multi-noise generator, biomes, landmarks
│   │   │   ├── tileset/             # Texture atlas slicer & manager
│   │   │   ├── GameLoop.ts          # RequestAnimationFrame ticker loop
│   │   │   └── World.ts             # World entity coordinator & camera controller
│   │   ├── network/                 # Binary DataView codecs, WebSockets, LiveKit voice
│   │   ├── store/                   # Zustand reactive state stores
│   │   └── ui/                      # React HUD overlays & modals
│   │       ├── components/building-editor/
│   │       ├── components/social/
│   │       ├── components/teleporter/
│   │       └── screens/Game.tsx
│   └── vite.config.ts               # Vite configuration with React compiler & optimizations
└── README.md                        # Master repository documentation
```

---

## Getting Started

### Prerequisites

* **Node.js**: v20+ with npm
* **Rust**: 1.82+ (`rustup toolchain install stable`)
* **Docker & Docker Compose**: For local PostgreSQL, Redis, PgBouncer, and LiveKit

---

### Step 1: Start Local Infrastructure

Spin up the local database, cache, connection pooler, and LiveKit SFU:

```bash
cd Backend
docker compose up -d
```

This starts:
* **PostgreSQL** on `localhost:5432`
* **PgBouncer** on `localhost:6432`
* **Redis** on `localhost:6379`
* **LiveKit SFU** on `localhost:7880`

Run the SQL migrations:
```bash
cargo install sqlx-cli --no-default-features --features postgres
sqlx migrate run --database-url postgres://synapse:synapse_dev_password@localhost:5432/synapse_db
```

---

### Step 2: Run the Backend Microservices

In separate terminal tabs, launch the backend services:

```bash
# 1. Start the Stateless REST Gateway (Port 8080)
cargo run --manifest-path Backend/Cargo.toml -p gateway

# 2. Start the Spatial Game Server (WebSocket Port 8081)
cargo run --manifest-path Backend/Cargo.toml -p game-server

# 3. Start the Background Worker Daemon (Periodic cold flusher & Ghost NPCs)
cargo run --manifest-path Backend/Cargo.toml -p worker
```

---

### Step 3: Run the Frontend Client

In the `Frontend/` directory:

```bash
cd Frontend
npm install
npm run dev
```

Open your browser at `http://localhost:5173` to enter the infinite MMO sandbox!

---

## Testing & Verification

Synapse enforces rigorous test coverage across both frontend rendering pipelines and backend distributed crates.

### Frontend Test Suite (Node.js Native Test Runner)
```bash
npm test --prefix Frontend
```
Executes **162 passing tests** across 63 suites with zero external mocks, validating:
* Coordinate conversions & chunk math (`RENDER_TILE_SIZE = 64`)
* Multi-noise determinism & Voronoi village distributions
* Loose viewport culling math & zero-allocation sprite recycling
* Collision resolution & anti-stuck safe spawn relocation
* Stacked prefab serialization & trimming
* Teleporter landmarks search & friend eligibility
* Social direct/group chat & friend request state mutations

### Frontend TypeScript Compilation & Production Build
```bash
npm run build --prefix Frontend
```
Ensures strict type checking (`tsc -b`) and bundles production assets via Vite with zero warnings or errors.

### Backend Rust Test Suite
```bash
cargo test --manifest-path Backend/Cargo.toml
```
Runs comprehensive tests across all 5 workspace crates and 3 microservices:
* `synapse-protocol`: Binary packet encoding/decoding roundtrips and JSON DTOs
* `synapse-spatial`: 3x3 AOI chunk diffing, audio culling hysteresis, and procedural terrain
* `synapse-storage`: DbRouter read/write replication, LSN consistency tracking, and chat repositories
* `synapse-common`: JWT auth token lifecycle and boarding pass signature validation
* `synapse-livekit`: Lazy SFU room creation, token minting, and mega-crowd downgrade

---

## Production Deployment & Scalability

Synapse is designed for zero-downtime, horizontally scalable Kubernetes deployments:

* **StatefulSets with Graceful Drain:** `game-server` runs as a Kubernetes `StatefulSet`. On scale-down, a `preStop` lifecycle hook triggers the server to lock inputs, flush all hot player states to PostgreSQL, broadcast a `SERVER_RESTART` packet with a migration boarding pass, and cleanly drain active connections.
* **KEDA Metric Autoscaling:** Scaled automatically via KEDA using Prometheus metrics monitoring `active_websocket_connections`.
* **Zero Cross-Server Contention:** Players transfer between servers and regional clusters using the **Boarding Pass Ticket Pattern**, eliminating distributed locking and cross-continent database synchronization.

---

## License

This project is licensed under the [MIT License](LICENSE).
