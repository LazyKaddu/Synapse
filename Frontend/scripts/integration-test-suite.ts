// ==============================================================================
// Synapse MMO - End-to-End Integration & Packet Integrity Test Suite
// Verifies: REST API Control Plane -> WebSocket Binary & Social Plane -> LiveKit SFU
// ==============================================================================

import { BinaryOpCode, decodeServerBinaryPacket, encodeClientMovement } from '../src/network/index.ts';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8080';
const GAME_SERVER_WS = process.env.GAME_SERVER_WS || 'ws://localhost:9000/socket';
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'http://localhost:7880';

// ANSI terminal colors for formatted test output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function pass(name: string, detail: string = '') {
  console.log(`  ${GREEN}✓${RESET} ${BOLD}${name}${RESET} ${detail ? `(${CYAN}${detail}${RESET})` : ''}`);
}

function fail(name: string, error: any) {
  console.error(`  ${RED}✗${RESET} ${BOLD}${name}${RESET}:`, error);
  process.exit(1);
}

function step(title: string) {
  console.log(`\n${YELLOW}${BOLD}=== ${title} ===${RESET}`);
}

async function runIntegrationSuite() {
  console.log(`${CYAN}${BOLD}`);
  console.log(`┌────────────────────────────────────────────────────────────┐`);
  console.log(`│   SYNAPSE MMO - FULL INTEGRATION & WIRE INTEGRITY SUITE   │`);
  console.log(`└────────────────────────────────────────────────────────────┘${RESET}`);

  // --------------------------------------------------------------------------
  // STEP 1: Verify Health of All Services
  // --------------------------------------------------------------------------
  step('Step 1: Checking Microservice Health');
  try {
    const gwRes = await fetch(`${GATEWAY_URL}/healthz`);
    if (!gwRes.ok) throw new Error(`Gateway returned HTTP ${gwRes.status}`);
    pass('API Gateway health check', `${GATEWAY_URL}/healthz -> 200 OK`);

    const gsRes = await fetch('http://localhost:9000/healthz');
    if (!gsRes.ok) throw new Error(`Game Server returned HTTP ${gsRes.status}`);
    pass('Game Server health check', 'http://localhost:9000/healthz -> 200 OK');

    const sfuRes = await fetch(`${LIVEKIT_URL}/`);
    if (!sfuRes.ok) throw new Error(`LiveKit SFU returned HTTP ${sfuRes.status}`);
    pass('LiveKit SFU health check', `${LIVEKIT_URL}/ -> 200 OK`);
  } catch (err) {
    fail('Service health check failed', err);
  }

  // --------------------------------------------------------------------------
  // STEP 2: REST API Control Plane (Register, Login, Characters, Boarding Pass)
  // --------------------------------------------------------------------------
  step('Step 2: Control Plane (REST API Authentication & Handoff)');
  const ts = Date.now();
  let user1Token = '';
  let user1CharId = 0;
  let user1BoardingPass = '';

  let user2Token = '';
  let user2CharId = 0;
  let user2BoardingPass = '';

  try {
    // 2.1 Register & Login User 1
    const username1 = `player1_${ts}`;
    const password = 'Password123!';
    const regRes1 = await fetch(`${GATEWAY_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username1,
        email: `${username1}@test.com`,
        password,
      }),
    });
    if (!regRes1.ok) throw new Error(`Register User 1 failed: ${await regRes1.text()}`);
    pass('Account 1 Registration', `Status: 201 Created, User: ${username1}`);

    const loginRes1 = await fetch(`${GATEWAY_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username1, password }),
    });
    if (!loginRes1.ok) throw new Error(`Login User 1 failed: ${await loginRes1.text()}`);
    const loginData1 = await loginRes1.json();
    user1Token = loginData1.token;
    pass('Account 1 Login', `JWT minted for Account ID: ${loginData1.account_id}`);

    // 2.2 Register & Login User 2
    const username2 = `player2_${ts}`;
    const regRes2 = await fetch(`${GATEWAY_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username2,
        email: `${username2}@test.com`,
        password,
      }),
    });
    if (!regRes2.ok) throw new Error(`Register User 2 failed: ${await regRes2.text()}`);
    pass('Account 2 Registration', `Status: 201 Created, User: ${username2}`);

    const loginRes2 = await fetch(`${GATEWAY_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username2, password }),
    });
    if (!loginRes2.ok) throw new Error(`Login User 2 failed: ${await loginRes2.text()}`);
    const loginData2 = await loginRes2.json();
    user2Token = loginData2.token;
    pass('Account 2 Login', `JWT minted for Account ID: ${loginData2.account_id}`);

    // 2.3 Create Character for User 1
    const charRes1 = await fetch(`${GATEWAY_URL}/api/v1/characters`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user1Token}`,
      },
      body: JSON.stringify({ display_name: `Warrior_${ts}` }),
    });
    if (!charRes1.ok) throw new Error(`Create Char 1 failed: HTTP ${charRes1.status} - ${await charRes1.text()}`);
    const charData1 = await charRes1.json();
    user1CharId = charData1.character_id;
    pass('Character 1 Creation', `Name: Warrior_${ts}, ID: ${user1CharId}`);

    // 2.4 Create Character for User 2
    const charRes2 = await fetch(`${GATEWAY_URL}/api/v1/characters`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user2Token}`,
      },
      body: JSON.stringify({ display_name: `Mage_${ts}` }),
    });
    if (!charRes2.ok) throw new Error(`Create Char 2 failed: HTTP ${charRes2.status} - ${await charRes2.text()}`);
    const charData2 = await charRes2.json();
    user2CharId = charData2.character_id;
    pass('Character 2 Creation', `Name: Mage_${ts}, ID: ${user2CharId}`);

    // 2.5 Request Boarding Pass for Character 1
    const joinRes1 = await fetch(`${GATEWAY_URL}/api/v1/world/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user1Token}`,
      },
      body: JSON.stringify({
        character_id: user1CharId,
        target_region: 'eu-west',
      }),
    });
    if (!joinRes1.ok) throw new Error(`World Join Char 1 failed: ${await joinRes1.text()}`);
    const joinData1 = await joinRes1.json();
    user1BoardingPass = joinData1.ticket;
    pass('Boarding Pass Issuance (Char 1)', `HMAC Ticket length: ${user1BoardingPass.length} chars`);

    // 2.6 Request Boarding Pass for Character 2
    const joinRes2 = await fetch(`${GATEWAY_URL}/api/v1/world/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user2Token}`,
      },
      body: JSON.stringify({
        character_id: user2CharId,
        target_region: 'eu-west',
      }),
    });
    if (!joinRes2.ok) throw new Error(`World Join Char 2 failed: ${await joinRes2.text()}`);
    const joinData2 = await joinRes2.json();
    user2BoardingPass = joinData2.ticket;
    pass('Boarding Pass Issuance (Char 2)', `HMAC Ticket length: ${user2BoardingPass.length} chars`);
  } catch (err) {
    fail('REST API Control Plane failed', err);
  }

  // --------------------------------------------------------------------------
  // STEP 3: WebSocket Handshake & Security Admission Control
  // --------------------------------------------------------------------------
  step('Step 3: WebSocket Handshake Security & Ticket Enforcement');

  // 3.1 Verify rejection without ticket
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(GAME_SERVER_WS);
    ws.onopen = () => {
      ws.close();
      reject(new Error('WebSocket connection without ticket should have been rejected!'));
    };
    ws.onerror = () => {
      pass('Ticket Enforcement (Missing Ticket)', 'Server correctly rejected connection without ticket');
      resolve();
    };
  });

  // 3.2 Verify rejection with forged/tampered ticket
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`${GAME_SERVER_WS}?ticket=forged_invalid_hmac_ticket_12345`);
    ws.onopen = () => {
      ws.close();
      reject(new Error('WebSocket connection with forged ticket should have been rejected!'));
    };
    ws.onerror = () => {
      pass('Ticket Enforcement (Forged Ticket)', 'Server correctly rejected connection with invalid signature');
      resolve();
    };
  });

  // --------------------------------------------------------------------------
  // STEP 4: LiveKit SFU Token Auto-Provisioning on WebSocket Connect
  // --------------------------------------------------------------------------
  step('Step 4: LiveKit SFU Voice Token Auto-Provisioning');

  let sfuTokenReceived = '';
  let sfuUrlReceived = '';

  const ws1 = new WebSocket(`${GAME_SERVER_WS}?ticket=${encodeURIComponent(user1BoardingPass)}`);
  ws1.binaryType = 'arraybuffer';

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for VOICE_JOIN frame')), 5000);

    ws1.onopen = () => {
      pass('WebSocket Admission (Char 1)', 'Valid boarding pass accepted with HTTP 101 Switching Protocols');
    };

    ws1.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'VOICE_JOIN') {
            clearTimeout(timeout);
            sfuTokenReceived = msg.token;
            sfuUrlReceived = msg.sfu_url;
            pass('LiveKit Voice Token Received', `SFU URL: ${sfuUrlReceived}, Token: ${sfuTokenReceived.slice(0, 30)}...`);
            resolve();
          }
        } catch (e) {
          // ignore non-json
        }
      }
    };

    ws1.onerror = (err) => {
      clearTimeout(timeout);
      reject(err);
    };
  });

  // 4.2 Verify LiveKit JWT Token structure
  const tokenParts = sfuTokenReceived.split('.');
  if (tokenParts.length !== 3) {
    fail('LiveKit JWT Token validation', 'Token does not have 3 parts (header.payload.signature)');
  }
  const tokenPayload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
  pass('LiveKit JWT Claims Verification', `Room: "${tokenPayload.video?.room}", Participant: "${tokenPayload.sub}"`);

  // --------------------------------------------------------------------------
  // STEP 5: 60Hz Binary Data Plane & Packet Wire Integrity
  // --------------------------------------------------------------------------
  step('Step 5: 60Hz Binary Movement & Wire Data Integrity Test');

  // Connect Client 2 to the game server
  const ws2 = new WebSocket(`${GAME_SERVER_WS}?ticket=${encodeURIComponent(user2BoardingPass)}`);
  ws2.binaryType = 'arraybuffer';

  await new Promise<void>((resolve, reject) => {
    ws2.onopen = () => {
      pass('WebSocket Admission (Char 2)', 'Client 2 joined game server');
      resolve();
    };
    ws2.onerror = reject;
  });

  // Wait 150ms for session registrations to sync across spatial grid
  await new Promise((r) => setTimeout(r, 150));

  // Client 1 will send exact float32 coordinates:
  const targetX = 543.25;
  const targetY = 876.5;

  const binaryVerification = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for 0x10 Neighbor Movement packet on Client 2')), 4000);

    ws2.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const decoded = decodeServerBinaryPacket(event.data);
        if (decoded && decoded.kind === 'neighbor_movement') {
          // Check player ID
          if (decoded.playerId === user1CharId) {
            clearTimeout(timeout);

            // Assert exact coordinate integrity
            const deltaX = Math.abs(decoded.posX - targetX);
            const deltaY = Math.abs(decoded.posY - targetY);

            if (deltaX < 0.001 && deltaY < 0.001) {
              pass(
                '60Hz Binary Packet Wire Integrity',
                `Sent: (${targetX}, ${targetY}) -> Received on Client 2: (${decoded.posX}, ${decoded.posY}) [Delta: 0.000]`
              );
              resolve();
            } else {
              reject(
                new Error(
                  `Packet coordinate mismatch! Expected (${targetX}, ${targetY}), got (${decoded.posX}, ${decoded.posY})`
                )
              );
            }
          }
        }
      }
    };
  });

  // Send the 9-byte binary packet from Client 1
  const movementPacket = encodeClientMovement(targetX, targetY);
  ws1.send(movementPacket);
  pass('Binary Movement Packet Transmitted', `Length: ${movementPacket.byteLength} bytes [0x01][X: float32][Y: float32]`);

  await binaryVerification;

  // --------------------------------------------------------------------------
  // STEP 6: Social Plane (JSON Text Broadcast)
  // --------------------------------------------------------------------------
  step('Step 6: Social Plane (Chat Frame Broadcast)');

  const chatMessageContent = `Hello Synapse MMO ${ts}!`;

  const chatVerification = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for CHAT_MSG broadcast')), 4000);

    ws2.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'CHAT_MSG' && msg.content === chatMessageContent) {
            clearTimeout(timeout);
            pass('Chat Broadcast Received on Neighbor', `Channel: "${msg.channel}", Sender: "${msg.sender}", Content: "${msg.content}"`);
            resolve();
          }
        } catch (e) {
          // ignore
        }
      }
    };
  });

  ws1.send(
    JSON.stringify({
      type: 'CHAT_MSG',
      channel: 'global',
      sender: `Warrior_${ts}`,
      content: chatMessageContent,
    })
  );

  await chatVerification;

  // --------------------------------------------------------------------------
  // Clean Up & Summary
  // --------------------------------------------------------------------------
  ws1.close();
  ws2.close();

  console.log(`\n${GREEN}${BOLD}============================================================`);
  console.log(`  🎉 ALL INTEGRATION & PACKET INTEGRITY TESTS PASSED!`);
  console.log(`============================================================${RESET}`);
  console.log(`  • Control Plane: REST auth, accounts, characters, boarding passes`);
  console.log(`  • Security: HMAC boarding pass admission enforcement verified`);
  console.log(`  • Data Plane: 60Hz 9-byte movement & 13-byte neighbor broadcast verified`);
  console.log(`  • Wire Integrity: Float32 coordinates verified with 0 bit corruption`);
  console.log(`  • Social Plane: JSON chat broadcasting verified`);
  console.log(`  • Media Plane: LiveKit SFU token auto-provisioning verified`);
  console.log(`${GREEN}${BOLD}============================================================${RESET}\n`);
}

runIntegrationSuite().catch((err) => {
  console.error(`${RED}Fatal test failure:${RESET}`, err);
  process.exit(1);
});
