# First Contact

An invite-only multiplayer sci-fi co-op game in the browser, somewhere between a ship simulator and an online shooter. An alien species sent Earth coordinates, ship blueprints, and the secret of perfect cloning. You and up to five crewmates take the colony ship **First Contact** to the meeting point.

This repo is the **first playable slice**:

- **Host / join.** The host launches a ship server and gets a 6-character invite code and link. Others join with it.
- **Crew rules, enforced on the server.** Max 6 players, exactly one Captain. Job caps: Captain 1, Engineer 3, Military 3, Doctor 2, Botanist 4. If five characters exist and none is the Captain, the last berth is reserved for the Captain.
- **Intro.** A short, skippable cinematic: launch from Earth, then rendezvous with the ship in lunar orbit.
- **Character creation in the clone lab.** You start as an unformed figure in a horizontal cloning tube. Pick body (male/female), face (smiling, serious, angry, flirty), short or long hair, facial hair for men (none, stubble, full beard), hair color, eye color, starting job (respecting caps), and a first and last name. The preview updates live in the tube.
- **Spawn and walk.** After you click Create, your clone steps out next to the tube in underwear with a floating `Job Firstname Lastname` nameplate. Everyone in the lab sees each other move in real time.
- **Persistence.** Ships and characters are saved to `server/data/ships.json`. Reload the tab, or come back later with the invite link, and you rejoin as the same character.

## Run it

Requires Node 20.11 or newer.

```bash
npm install
npm run dev
```

Then open **http://localhost:47321**.

| Process | Port | Notes |
| --- | --- | --- |
| Vite client | `47321` | Proxies `/ws` to the game server, so one URL is all players need |
| Game server (Node + `ws`) | `47322` | `GET /health`; WebSocket at `/ws` |

To try multiplayer on one machine, open the invite link in a second tab or window. Player identity is kept per tab (`sessionStorage`), so each tab is a separate crewmate. Crewmates on your LAN can use the `Network:` URL Vite prints.

### Controls

- `W` `A` `S` `D` or arrow keys to move, `Shift` to run
- Drag to orbit the camera, scroll to zoom
- `Space`, `Enter`, or `Esc` skips the intro
- On touch devices, an on-screen joystick appears after you create your character

### Other scripts

```bash
npm run typecheck   # server + client
npm run build       # production build of the client into client/dist
```

Environment variables: `PORT` (server port, default `47322`), `DATA_FILE` (save file path), and `SERVER_PORT` (tells the Vite proxy where the server is).

## Layout

```
shared/     protocol types, job caps and validation, clone lab layout (used by client and server)
server/     Node WebSocket server: ships, membership, character creation, movement relay, JSON persistence
client/     Vite + TypeScript + Three.js
  src/scene/intro.ts      Earth, Moon, rocket launch and rendezvous cinematic (also the title backdrop)
  src/scene/ship.ts       the First Contact ship model
  src/scene/lab.ts        clone lab, tubes, players, movement, camera
  src/scene/character.ts  low-poly character builder and animation
  src/ui.ts               title screen, HUD, character creator, joystick
```

## Networking model

The server is authoritative for membership, job assignment, character data, and spawn position. Movement is client-predicted: clients send position at 15 Hz, the server clamps it to the lab bounds, and it broadcasts snapshots at about 15 Hz. Remote players are smoothed on the client.
