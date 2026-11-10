**Project: Infinite Spatial MMO**

**The Product Vision**
We are building a browser-native, ultra-low-latency 2D Massively Multiplayer Online (MMO) game that drops thousands of concurrent players into an infinitely expanding, procedurally generated universe. Designed to rival the social presence of platforms like VRChat or Gather.town but with the mechanical depth of a traditional RPG, the game runs at a flawless 60 FPS directly in the web browser without requiring a single map download.

**The Player Experience (Gameplay & World)**

* **The Infinite Sandbox:** Players spawn into a vast, seamless world dictated by biomes (forests, deserts, oceans). Because the terrain is procedurally generated using a shared mathematical seed, the world is practically infinite. There are no loading screens as players walk; new chunks materialize seamlessly at the edges of their vision.
* **High-Fidelity Movement:** Unlike traditional web games that feel floaty or laggy, movement is calculated at 60 FPS on the client and validated at a strict 10Hz tick rate on the server, resulting in crisp, responsive, and rubber-band-free traversal.
* **Player Economy & Trading:** Players can acquire items and trade them securely. A strict ACID-compliant database architecture ensures that high-stakes trades, inventory management, and global economies cannot be duplicated or hacked.

**The Social Fabric (Communication & Presence)**

* **Proximity Voice Chat:** The core social mechanic is spatial audio. As players walk into a crowded town square, they hear the murmur of dozens of conversations. As they walk closer to a specific group, those voices get louder and pan dynamically left or right in their headphones based on their exact screen coordinates.
* **The Inter-Region Phone Network:** Players are not isolated to their current physical server. Using a central global presence system, a player exploring a dungeon on the `EU-West` server can pull out an in-game phone and dial their friend on the `NA-East` server. The game seamlessly tunnels a peer-to-peer WebRTC audio call between the two regions, allowing them to talk while continuing to play in entirely different parts of the world.

**The Technical Edge (Why it scales)**

* **Zero-Bandwidth Terrain:** The game world takes up zero bytes on the server's hard drive and requires zero bandwidth to transmit. The Rust backend and PixiJS frontend use the exact same deterministic OpenSimplex noise algorithms to generate mountains and rivers on the fly.
* **Binary-First Networking:** To support massive player density, the game completely bypasses the browser's JSON bottleneck. Player movements are packed into raw 13-byte C-style arrays, allowing the client to process thousands of neighbor updates per second without triggering JavaScript garbage collection stutters.
* **Hardware-Optimized Audio:** The engine protects the player's CPU by hard-culling audio. Even if 1,000 players are in a single zone, the Rust server dynamically filters the network to only stream the UDP voice tracks of the 50 closest people, maintaining absolute performance.

This is not just a standard web game; it is a highly concurrent, horizontally scalable spatial engine disguised as a 2D RPG (game).
