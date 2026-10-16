# Netcode

The server runs the real game; clients send inputs and draw what the server says happened. Your own character is predicted locally so it responds instantly; everything else is drawn slightly in the past, smoothly.

## Rates

| Item | Value | Why |
|---|---|---|
| Server simulation tick | 30 Hz (33.3 ms), fixed step | Enough precision for top-down movement at half the CPU of 60 Hz |
| Snapshot rate, near (within 25 m) | 15 Hz | Smooth with a ~100 ms interpolation buffer |
| Snapshot rate, far (25–40 m) | 5 Hz | Distant zombies move slowly on screen |
| Interest radius | 40 m | Nothing farther is sent |
| Client input rate | 30 Hz, each packet repeats the last 3 inputs | A lost packet loses no input |
| Client render rate | the display's refresh rate, independent of the tick | |
| Interpolation delay | adaptive, 67–300 ms | Covers the 95th percentile of snapshot lateness; about 75 ms on a clean link, about 180 ms at 2 % loss |
| Lag compensation rewind | up to 300 ms | Matches the largest interpolation delay, so hits stay fair on lossy links |

If a tick runs late, the server runs the missed ticks back to back (up to 3) instead of slowing the game clock. Each room's heavy work, such as rebuilding its flow field, is spread across ticks so rooms on one process never spike together.

## Transport

- **WebSocket** works everywhere and is always available.
- **WebTransport** is used when the browser supports it: snapshots and inputs travel as unreliable datagrams, everything else on a reliable stream. A lost datagram never delays the ones behind it, which keeps remote entities smooth on lossy connections; on WebSocket (TCP), one lost packet holds up everything behind it.
- Inputs are sent redundantly and one-off events are reliable. On WebSocket each snapshot is a delta against the previous one sent on that connection; with datagrams, snapshots become deltas against the last snapshot the client acknowledged (every input already carries that acknowledgement).

## Messages

All messages are binary; the first byte is the message type. Encoding lives in `packages/protocol`, shared by server and client, with round-trip tests for every type.

### Client to server

| Type | Contents | Delivery |
|---|---|---|
| `hello` | protocol version, game ticket | reliable |
| `input` | sequence number, last 3 inputs (movement, aim angle, buttons, the snapshot tick being displayed), acknowledged snapshot id | unreliable |
| `ping-wheel`, `quick-chat` | phrase id, world position | reliable |
| `ready`, `vote` | checkpoint and restart votes | reliable |
| `pong` | echo of server time | unreliable |

Reload, weapon swap, interact and abilities are bits in the `input` button field, so they are repeated like any input.

### Server to client

| Type | Contents | Delivery |
|---|---|---|
| `welcome` | your entity id, map, server tick, your build (class, level, skills, loadout with upgrades), so prediction uses the server's numbers | reliable |
| `snapshot` | snapshot id, tick, last processed input, wave, kills, score, round-trip time measured by the server, your full state, other players, acid pools, changed zombies, removals | unreliable |
| `event` | batched one-off events: shots, hits, kills, grenades launched and exploding, bursts, pickups, buffs, objective updates, mutation alerts, downed, revived | reliable |
| `mission` | checkpoint reached, mission result | reliable |
| `ping` | server time | unreliable |
| `kick` | reason | reliable |

## Snapshot encoding

- Each zombie record is a varint id (relative to the previous id), a flag byte, and only the fields that changed: position as a 1-byte delta per axis for small moves (1/64 m steps) or 2 bytes absolute; facing in 1 byte; health in 1 byte; type in 1 byte when the zombie first appears.
- A zombie that died or left the interest radius is its id plus a flag.
- A client that connects or reconnects gets a full snapshot first.

With 300 zombies, 4 players and a 40 m interest radius, snapshots average about 9–10 KB/s per player; with the whole horde of 300 in view and moving, about 21 KB/s. A full room's tick, including encoding four snapshots, costs about 0.12 ms.

## Prediction and reconciliation

1. The client samples input, sends it, and immediately applies it to its own player with `sim.stepPlayer()`, the same function the server runs.
2. Each predicted state is stored with its input sequence number.
3. Each snapshot carries the server's state for this player and the last input it processed. The client resets to that state and replays every later input.
4. Corrections under 0.5 m are eased over 100 ms; larger ones (knock-back, being grabbed) snap.
5. Firing is predicted for feedback (muzzle flash, tracer, sound, magazine count); damage, kills and drops appear only when the server confirms them.

The simulation is deterministic: fixed steps, server-owned seeded randomness, and no `Date.now()` or `Math.random()` in `packages/sim`.

## Input handling on the server

- Each player's inputs wait in a queue; the server applies at most one per tick.
- A player whose input has not arrived simply does nothing that tick. The server never replays an old input, because that would move the player twice and break prediction.
- After a network stall the queue may hold several inputs; above three, the server applies two per tick until the player has caught up.
- Inputs are rate-limited with a token bucket (30 per second, bursts up to 24), so a modified client cannot move faster by sending more inputs.

## Interpolation

Other players and zombies are drawn at `serverTime − interpolationDelay`, between the two snapshots around that time. The delay is the 95th percentile of how late recent snapshots arrived, plus one snapshot interval, between 67 and 300 ms; it grows at once and shrinks gently. If the next snapshot is still late, positions are extrapolated from the last two snapshots for up to 150 ms, then hold.

## Measured behaviour

Bots behind `tc netem` (75 ms each way, loss applied in both directions), 8 players in 2 rooms, 60 seconds per run, WebSocket:

| Round trip, loss | Snapshots >100 ms late | Frames with nothing to draw | Interpolation delay | Prediction corrections |
|---|---|---|---|---|
| 150 ms, 0 % | 0 % | 0 % | 77 ms | 0 |
| 150 ms, 2 % | 6.2 % | 0.7 % | 182 ms | 0 |
| 150 ms, 5 % | 16.9 % | 0.9 % | 269 ms | 0 |

Your own movement and shooting stay exact at every loss rate. What TCP costs is how far in the past other players and zombies are drawn; datagrams (WebTransport) would bring that back to about 75 ms.

## Lag compensation

The server keeps 8 ticks of zombie positions. A shot carries the tick the client was displaying; the server rewinds zombies to that tick (at most 200 ms back), tests the hit, and applies damage in the present. Zombies are never rewound for their own attacks.

## Connection, reconnect and disconnect

- **Connect**: the game ticket is checked, then `welcome` is sent.
- **Heartbeat**: `ping`/`pong` every second for clock sync and latency display; 5 seconds of silence counts as a disconnect.
- **Disconnect mid-mission**: the character stays in the world and the seat is held for **120 seconds**.
- **Reconnect**: the client gets a new ticket for the same room, receives a full snapshot and resumes. If the room has ended, the player goes to the results screen.
- **Grace expired**: the character leaves the mission and the seat is released.
- **Game server failure**: players return to the lobby; progress since the last checkpoint is lost; saved progress is safe.

## Bandwidth budget per player

| Direction | Item | Average | Peak (1-second window) |
|---|---|---|---|
| Down | Snapshots | 10 KB/s | 15 KB/s |
| Down | Events | 3 KB/s | 8 KB/s |
| Down | Framing and packet headers | 1.5 KB/s | 2 KB/s |
| **Down total** | | **≈ 14 KB/s** | **≤ 25 KB/s** |
| Up | Inputs and headers | 2.5 KB/s | 3 KB/s |

At 24 players that is about 2.7 Mbit/s down on average and under 5 Mbit/s at peak.
