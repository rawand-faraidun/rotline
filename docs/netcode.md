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
- **A direct address.** The site sits behind a CDN, and for some regions the route through it is far slower than the route to the game server itself (about 230 ms a round trip against 80 ms from Iraq). The API can name a direct address for the game connection with every ticket; the client tries it first and falls back to the game path on the site if it has not opened within 5 seconds. Only the game connection uses it; pages, sign-in and the API stay behind the CDN. The address serves nothing but the game connection and limits new connections per client address; the signed ticket is what actually lets a player in.
- **WebTransport** is used when the browser supports it: snapshots and inputs travel as unreliable datagrams, everything else on a reliable stream. A lost datagram never delays the ones behind it, which keeps remote entities smooth on lossy connections; on WebSocket (TCP), one lost packet holds up everything behind it.
- Inputs are sent redundantly and one-off events are reliable. On WebSocket each snapshot is a delta against the previous one sent on that connection; with datagrams, snapshots become deltas against the last snapshot the client acknowledged (every input already carries that acknowledgement).

## Messages

All messages are binary; the first byte is the message type. Encoding lives in `packages/protocol`, shared by server and client, with round-trip tests for every type. The protocol is versioned (currently version 6); the `hello` carries the client's version.

### Client to server

| Type | Contents | Delivery |
|---|---|---|
| `hello` | protocol version, game ticket | reliable |
| `input` | sequence number, last 3 inputs (movement, aim angle, 16 button bits, the snapshot tick being displayed, the cursor's distance for throws), acknowledged snapshot id | unreliable |
| `range` | firing range only: spawn zombies of a type, or clear them | reliable |
| `pause` | the pause menu opened or closed | reliable |
| `ping-wheel`, `quick-chat` (planned) | phrase id, world position | reliable |
| `ready`, `vote` (planned) | checkpoint and restart votes | reliable |
| `pong` | echo of server time | unreliable |

Reload, weapon swap, interact, the three abilities and the two utilities are bits in the `input` button field, so they are repeated like any input.

### Server to client

| Type | Contents | Delivery |
|---|---|---|
| `welcome` | your entity id, map, server tick, your build (class, level, skills, loadout with upgrades), so prediction uses the server's numbers; the mission id and difficulty (empty outside missions); a fingerprint of the game data (maps, props, missions, zombies, weapons, the campaign) | reliable |
| `snapshot` | snapshot id, tick, last processed input, wave, kills, score, round-trip time measured by the server, your full state (including cooldowns, charges, haste, dash and minigun timers, whether you are carrying something and whether a mission step has your kit jammed), the mission frame (below), other players, acid pools, map prop changes (below), objects (zones, barricades, mines, decoys, sentries, mortar markers, buff pickups with a variant byte naming the buff), changed zombies with their status bits (stunned, slowed, marked, poisoned, taunted, burning, hunted by the objective), removals | unreliable |
| `event` | batched one-off events: shots, hits, kills, grenades launched and exploding, bursts, abilities, player hurt, downed, back up, out and revived, waves started and cleared, squad wipes, objective done (with a flag for the first time; optional objectives too), objective failed (a survivor or defend target lost, or the extraction timer run out), checkpoint, map prop changed state, mission complete, buff picked up, score threshold, Survival run over; item found and cache opened are sent only to the player concerned | reliable |
| `roster` | names, connection state, class and loadout weapons of everyone in the room (so teammates are drawn as their class, holding their gun) | reliable |
| `results` | your results: success, rounds survived (Survival), time, score, kills, XP, Salvage, downs, items found, mastery | reliable |
| `ping` | server time | unreliable |
| `kick` | reason (bad ticket, room full, protocol error, replaced, shutdown, idle, mission complete, playing elsewhere) | reliable |

The mission frame in each snapshot holds the mission status, the current objective, its progress and goal, the seconds left on team buffs (Double XP, Instakill), your own score, your kill chain (0 once its timer has run out) and how much of the chain timer is left, and a bitmask of the caches you have opened. For an extraction the progress is the time used, so the client shows the time left.

A client whose game data has another fingerprint than the server's closes the connection and asks the player to reload: its map props, collisions and prediction would not match the server's.

The `results` message is sent after the events of the tick that ended the mission or run, so the client shows the final moments first, and is sent again to a player who reconnects during the 20-second results window.

## Snapshot encoding

- Each zombie record is a varint id (relative to the previous id), a flag byte, and only the fields that changed: position as a 1-byte delta per axis for small moves (1/64 m steps) or 2 bytes absolute; facing in 1 byte; health in 1 byte; type in 1 byte when the zombie first appears.
- A zombie that died or left the interest radius is its id plus a flag.
- Map props (barrels, cover, doors, generators, terminals, turrets, floodlights, traps, survivors, carried objects, defend targets) are not limited by the interest radius. Each record is 9 bytes: the prop's index, its state with two flag bits (powered, for turrets and floodlights; cooling down, for traps), its health and hold progress as fractions of 255, and its position. The first snapshot on a connection carries every prop; after that only props whose state, health, progress or position changed. A snapshot holds at most 4,096 props.
- A client that connects or reconnects gets a full snapshot first.

With 300 zombies, 4 players and a 40 m interest radius, snapshots average about 9–10 KB/s per player; with the whole horde of 300 in view and moving, about 21 KB/s. A full room's tick, including encoding four snapshots, costs about 0.12 ms, about the same on the Depot, the largest map with props (`pnpm bench [rooms] [ticks] [map]` in the game server).

## Prediction and reconciliation

1. The client samples input, sends it, and immediately applies it to its own player with `sim.stepPlayer()`, the same function the server runs.
2. Each predicted state is stored with its input sequence number.
3. Each snapshot carries the server's state for this player and the last input it processed. The client resets to that state and replays every later input.
4. Corrections under 0.5 m are eased over 100 ms; larger ones (knock-back, being grabbed) snap.
5. Firing is predicted for feedback (muzzle flash, tracer, sound, magazine count); damage, kills and drops appear only when the server confirms them.
6. Timed effects (haste, Slide Dash, the minigun) count the player's own input steps, not server ticks, so prediction stays exact when the server applies two inputs in one tick or none after a stall. Abilities trigger while their key is held and they are ready.
7. Abilities are predicted only for what they do to the player: cooldowns, utility charges, Adrenaline and Stim haste, Slide Dash, Overwatch and the minigun. Their effect on zombies and teammates (blasts, heals, stuns, barricades) comes from the server. Barricades are walls in the client's grid too: snapshots carry their exact cells, so prediction stops where the server does.
8. Map props are built in the client from the same game data, and their blocking cells (closed and welded doors, cover, barrels, generators and the like) are walls in its grid. Each prop change in a snapshot is applied to that grid, so prediction collides where the server does. Carrying an object is predicted too: it slows the player to the same speed the server uses, and the snapshot's carrying flag corrects it.

The simulation is deterministic: fixed steps, server-owned seeded randomness, and no `Date.now()` or `Math.random()` in `packages/sim`. Each room's seed, and a separate seed for loot (items and buffs), come from cryptographic randomness on the game server, so neither can be predicted, and loot rolls do not share a random stream with the fight.

## Input handling on the server

- Each player's inputs wait in a queue; the server applies at most one per tick.
- Interact presses are counted per input, so a quick tap carried by a catch-up input still opens a door or sets off a trap.
- A player whose input has not arrived simply does nothing that tick. The server never replays an old input, because that would move the player twice and break prediction.
- After a network stall the queue may hold several inputs; above three, the server applies two per tick until the player has caught up. Events from the extra input (shots, kills, throws) are sent and counted like any other.
- Every socket has a message budget (120 a second, bursts of 60); a client that keeps exceeding it is disconnected. Firing-range commands have their own small budget, and a range room holds at most 60 spawned zombies.
- A reconnecting client numbers its inputs from 1 again; the server resets its record of the last input for that player.
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
- **Disconnect mid-mission**: the character stays in the world and the seat is held for **120 seconds**. The character is marked away: its held buttons are cleared (it works nothing), and an extraction does not wait for it. Reconnecting clears the mark.
- **Reconnect**: the client gets a new ticket for the same room, receives a full snapshot and resumes. A player reconnecting during the results window gets the results again.
- **Grace expired**: the character leaves the mission and the seat is released.
- **Mission complete or run over**: the room leaves the registry at once, so the squad is back in the lobby; the room stays open 20 seconds for the results, then closes its connections (kick reason "complete"). A closed room's id is refused for 5 minutes, so no late ticket can start it again.
- **One squad room per player**: while connected, a player holds a claim on their room in Valkey, refreshed every second by the game server. A ticket for another room is refused while the claim stands; if the player gets into another room anyway, the first room disconnects them (kick reason "elsewhere").
- **Pause**: in a room of one, the pause menu stops the simulation (up to 10 minutes); inputs sent meanwhile are dropped and pings keep the connection alive. With more than one player the game goes on.
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
