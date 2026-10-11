# First Contact

An invite-only multiplayer sci-fi co-op game in the browser, somewhere between a ship simulator and an online shooter. An alien species sent Earth coordinates, ship blueprints, and the secret of perfect cloning. You and up to five crewmates take the colony ship **First Contact** to the meeting point.

This repo is the **first playable slice**:

- **Host / join.** The host launches a ship server and gets a 6-character invite code and link. Others join with it.
- **Crew rules, enforced on the server.** Max 6 players, exactly one Captain. Job caps: Captain 1, Engineer 3, Military 3, Doctor 2, Botanist 4. If five characters exist and none is the Captain, the last berth is reserved for the Captain.
- **Intro.** A short, skippable cinematic: launch from Earth, then rendezvous with the ship in lunar orbit.
- **Character creation in the clone lab.** You start as an unformed figure in a horizontal cloning tube. Pick body (male/female), face (neutral, smiling, serious, angry, flirty), a hairstyle (male: parted, buzzed; female: buzzed, buns, long), facial hair for men (none, stubble, full beard), hair color (12), eye color (12), starting job (respecting caps), and a first and last name. The preview updates live in the tube.
- **Spawn and walk.** After you click Create, your clone steps out next to the tube in underwear with a floating `Job Firstname Lastname` nameplate. Everyone sees each other move in real time.
- **The seed ship, walkable.** The whole hub-and-spoke ship is one continuous level-0 greybox: the Commons, bunk room, Captain's cabin, medical lab, hibernation and cloning bay, greenhouse, hold, science lab, operations, bridge, fore and aft nodes, octagonal corridors and the engine room. See [The ship interior](#the-ship-interior).
- **Persistence.** Ships and characters are saved to `server/data/ships.json`. Reload the tab, or come back later with the invite link, and you rejoin as the same character.

## Run it

Requires [Node.js](https://nodejs.org) 20.11 or newer (22 LTS recommended).

```bash
npm install
npm run dev
```

Then open **http://localhost:47321**. This starts two processes:

| Process | Port | Notes |
| --- | --- | --- |
| Vite client | `47321` | Proxies `/ws` to the game server, so one URL is all players need |
| Game server (Node + `ws`) | `47322` | `GET /health`; WebSocket at `/ws` |

To try multiplayer on one machine, open the invite link in a second tab or window. Player identity is kept per tab (`sessionStorage`), so each tab is a separate crewmate.

### On a Windows PC

1. Install Node.js: download the **LTS** "Windows Installer (.msi)" from <https://nodejs.org> and run it with the defaults. Alternatively, run `winget install OpenJS.NodeJS.LTS` in PowerShell.
2. Open a **new** PowerShell or Terminal window so `node` is on your PATH, and check it with `node -v` (it should print v20.11 or newer).
3. Get the code, either with `git clone <repo-url>` (Git for Windows: `winget install Git.Git`) or by downloading the ZIP from the repo page and extracting it.
4. In that folder:

   ```powershell
   cd first-contact
   npm install
   npm run dev
   ```

5. Open **http://localhost:47321** in Chrome, Edge, or Firefox. Keep the terminal open while you play; `Ctrl+C` stops the servers.

The first time, Windows Defender Firewall may ask whether Node.js can accept connections. Allow it on **Private networks** if friends on your Wi-Fi or LAN will join.

### Playing with friends

Everything goes through the single client port **47321**, including the WebSocket (`/ws` is proxied to the game server). That is the only port you need to share. Hosting a ship in the game just creates a crew on *your* server, so the person running `npm run dev` should stay online while others play.

**Same network (LAN / Wi-Fi):** `npm run dev` prints a `Network:` URL such as `http://192.168.1.23:47321`. Friends open that, or your invite link with `localhost` replaced by that IP.

**Different networks, option A: a tunnel (easiest, no router changes).** Run one of these in a second terminal while `npm run dev` is running, then share the `https://…` URL it prints. Open the game through that URL yourself before you host, so the invite link you copy uses it too.

```powershell
# Cloudflare quick tunnel (free, no account): winget install Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:47321

# or ngrok (free account + authtoken): winget install ngrok.ngrok
ngrok config add-authtoken <your-token>
ngrok http 47321
```

`*.trycloudflare.com` and `*.ngrok*` hostnames are already allowed by the dev server. For any other tunnel or domain, set `ALLOWED_HOSTS` before starting, for example in PowerShell `$env:ALLOWED_HOSTS="play.example.com"; npm run dev`. WebSockets work through both tunnels, and HTTPS pages automatically use `wss://`.

**Different networks, option B: port forwarding.**

1. Give your PC a fixed LAN IP (a DHCP reservation in the router).
2. Forward **TCP 47321** from the router to that IP.
3. Allow Node.js through Windows Firewall. If you weren't prompted, run this in an admin PowerShell: `New-NetFirewallRule -DisplayName "First Contact" -Direction Inbound -Protocol TCP -LocalPort 47321 -Action Allow`.
4. Friends open `http://<your-public-ip>:47321`. Look up your public IP at any "what is my IP" site.

This doesn't work on carrier-grade NAT (common on mobile or satellite internet). Use a tunnel instead. Only share invite links with people you trust: this is a dev server with no accounts.

### Controls

Classic third-person MMO scheme. The mouse cursor stays free and visible; there is no pointer lock.

| Input | Action |
| --- | --- |
| `W` / `S` (or `↑` / `↓`) | Move forward / backward along the way your character faces |
| `A` / `D` (or `←` / `→`) | Strafe left / right (the character keeps facing the same way) |
| `Shift` (hold) | **Sprint** (4.8 m/s). A burst: the stamina bar drains in about 3 s and refills in about 6 s, and you cannot sprint again until it has recovered a little |
| `C` | Toggle **walk** (1.5 m/s) and **jog** (3.5 m/s, the default) |
| Right mouse + drag | **Turn the character**; the camera stays behind it. The browser context menu is off over the game view only |
| Left mouse + drag | **Orbit the camera** around the character without turning it; drag up to look up (the camera drops to near floor level, so door signs come into view). On release the camera eases back behind the character (about 0.4 s); start moving mid-orbit and it snaps back faster (about 0.15 s) |
| Scroll wheel | Zoom in / out. Walls and corridor hulls between the camera and your character fade out so the interior stays readable |
| `Space`, `Enter`, `Esc` | Skip the intro |

Letting go of every key stops you; switching windows or tabs releases all keys. `Space`, `Tab` and the arrow keys do not scroll or move focus while you are playing. On touch devices an on-screen joystick appears after you create your character (it moves relative to the camera), and dragging the view orbits it.

The HUD shows the room you are in and flashes its name when you enter.

### Other scripts

```bash
npm run typecheck   # server + client
npm run build       # production build of the client into client/dist
npm run check:controls  # unit check of the camera/movement math in client/src/input/
npm run check:door  # cabin door server cycle: blocks closed, passes open, auto-closes and blocks again
```

Environment variables: `PORT` (server port, default `47322`), `DATA_FILE` (save file path), `SERVER_PORT` (tells the Vite proxy where the server is), and `ALLOWED_HOSTS` (extra comma-separated hostnames the dev server accepts).

## Layout

```
shared/     protocol types, job caps and validation, ship layout and interior data, movement rules (used by client and server)
  shipLayout.ts           exterior data: modules, shapes, heights, corridors, doors, docks, lift
  shipInterior.ts         interior data derived from it: walk shapes, props, stations, spawns, berths, `clampToShip`
  shipInterior.check.ts   `npm run check:layout`: overlaps, blocked doors and ports, reachability from the pods
  bunks.ts                memory upload stations derived from the bunk and bed props; berth claim rules, hover text
  movement.ts             walk/jog/sprint speeds, the stamina rule, and the server's per-player movement budget
  lab.ts                  the bay's pod constants and `spawnFor` (the bay is the world origin)
server/     Node WebSocket server: ships, membership, character creation, movement relay, JSON persistence
  src/bunks.ts            berth claims and memory upload snapshots (server-authoritative, one player per berth)
client/     Vite + TypeScript + Three.js
  src/scene/intro.ts      Earth, Moon, rocket launch and rendezvous cinematic (also the title backdrop)
  src/scene/ship.ts       the First Contact ship model
  src/scene/lab.ts        the ship scene: players, movement, camera
  src/scene/shipInterior.ts   builds the interior from the shared data: floors, walls, corridors, ceilings, lights, cutaway
  src/scene/interior/     greybox materials, batching, label sprites, and prop builders (pods, tanks, consoles, bunks, ...)
  src/scene/character.ts  rigged glTF characters: appearance, procedural expressions, animation
  public/models/          built character assets: bodies, motion-capture clips (clips-<sex>.glb, motion.json), uniform textures (see Credits)
  src/scene/characterMotion.ts   gait selection, clip playback rate, crossfades
  src/scene/uniform.ts    uniform material and per-job accent recolouring (DEFAULT_ACCENT / UNIFORM_ACCENT_BY_JOB)
  gallery.html            dev-only expression gallery: /gallery.html?view=close or ?view=game
  expressions.html        dev-only contact sheet of every face (selectable and prototype) on both heads
  characters.html         dev-only gallery of the Quaternius characters with retargeted mocap: /characters.html
  dev-assets/characters/  retargeted character assets for that gallery (not part of the game build)
tools/      offline asset pipeline (build-characters.mjs, build-character-clips.mjs, blender/); not needed to run the game
  src/ui.ts               title screen, HUD, character creator, joystick
```

## Networking model

The server is authoritative for membership, job assignment, character data, and spawn position. Movement is client-predicted: clients send position at 15 Hz, the server limits the step to what the movement rule allows, clamps it with `clampToShip(x, z, level)` (walkable area minus obstacles), and broadcasts snapshots at about 15 Hz. Remote players are smoothed on the client, and their walk, jog or sprint animation is picked from the speed seen between snapshots.

**Movement cap.** Each player has a token-bucket budget on the server (`MoveBudget` in `shared/movement.ts`): jog speed plus 12% tolerance, and a stamina-sized reserve that pays for the sprint burst (about 3 s from a full bar, refilling over about 6 s). A single message can never move a player more than about 1.9 m. A client that claims more simply lags behind where it says it is; honest clients are never clipped.

**Protocol.** Unchanged: `move` is still `{ x, z, rot, moving }`, and `PlayerState.tube` is still the pod index. The server owns the level (always 0 for now, the hangar is sealed), so no `level` field is sent yet. The lift, `spawnId`, `berth` and `useLift` from the layout plan arrive with the lift and bunk assignment slices.

## The ship interior

The interior is generated from two shared data files, so the client and server cannot disagree about where walls are.

- `shared/shipLayout.ts` is the exterior source of truth (module rects, shapes, heights, corridors, doors, docks, lift). This slice removed the NPC dorm's `dorm-grow` dock (single-connection rule), marks the dorm's two doors `sealed`, and adds `maxPorts: 1` for the dorm and the Captain's cabin.
- `shared/shipInterior.ts` adds, per room: the **walk shapes** (rects, or circles for the round greenhouse and cabin, a plus-and-disc for the nodes, two rects for the bridge's cut rear corners), the **props** (each solid prop is also an obstacle), **stations**, **spawns** (6 pods and 4 clone tanks in the bay), **berths** (0 in the cabin, 1 to 9 in the bunk room) and the NPC dorm panel. `clampToShip(x, z, level)` keeps a point inside the union of walk shapes and door thresholds minus obstacles; `spaceAt` names the room or corridor under a point.

Rooms (all level 0): The Commons (lounge, eatery, R&R, holo table, lift pad with the hangar hatch sealed, flush skylight), Crew Quarters (9 bunks in three stacks with closets, a memory upload pad on every bunk, sealed NPC dorm bulkhead with a status panel), Captain's Cabin (berth 0 with its own upload pad, trunk, desk with data pad, keypad prop on the locked door; the lock does nothing yet), Medical Lab, Hibernation and Cloning Bay (the old lab: 6 pods, 4 tanks), Greenhouse (six planters under a glass dome), Cargo Hold, Science Lab, Operations, Bridge (star map, two scanning stations, comms, chair, view screens on the nose), fore and aft nodes, corridors and the hangar pass-through, and a placeholder Engine Room. Free ports show as sealed octagonal hatches with a red outline, and the interior keeps their door-sized clear zones empty.

Dev helper: `npm run check:layout` fails on overlapping props, props blocking a door lane or a free port, and any station, spawn, berth or door that cannot be reached from the first pod.

## Characters

Clones are rigged, low/mid-poly glTF models (about 7k vertices each) sharing one UE-style skeleton, wearing a painted crew uniform (sleeve bands, shoulder patches and collar in the colour of their job). Motion is gendered motion capture (idle, walk, jog, sprint) chosen from the ground speed and played at the rate that makes the feet track the ground, with crossfades between gaits; remote players derive their gait from the speed between position snapshots. The base meshes have no facial rig, so the expressions are procedural morph targets (not texture variants). They are generated at load time around mouth, eye, and brow landmarks found through the painted face texture's UVs:

- **Neutral (default):** no morphs.
- **Smiling:** raised mouth corners and cheeks, lifted brows.
- **Serious:** pressed lips and a slight furrow.
- **Angry:** a frown, brows pulled down and in, narrowed eyes.
- **Flirty:** a soft one-sided smirk, half-lowered lids, one raised brow, and the occasional wink.

Everyone blinks. More faces are only sets of morph weights: `/expressions.html` shows the candidates not yet selectable (worried, tired, surprised) next to the eight selectable ones (neutral, smiling, serious, angry, flirty, calm, determined, smirk); add one to `FACES` in `shared/protocol.ts` and `EXPRESSIONS` in `scene/character.ts` to ship it. Hair, beard, and eyes are tinted per character; "no facial hair" swaps to a clean-shaven skin texture.

### Hairstyles

Only styles from the Quaternius pack that sit properly on that sex's head are offered (`HAIR_STYLES` in `shared/protocol.ts`): male parted and buzzed, female buzzed, buns and long. The pack's long hair and buns are cut for the female head (on the male head they leave the crown bare), and its parted and buzzed styles are cut for the male head. Characters saved before hairstyles had ids (`hairLength` short/long) are upgraded when the server loads them.

### Motion-capture gallery (dev only)

`/characters.html` (run `npm run dev -w client`) shows the Quaternius male and female playing motion-capture clips (idle, walk, jog, sprint) from the ACCAD Open Motion Project, in a painted crew uniform or bare, with a toggle between gendered gait styling and the raw performer motion. The game plays the same styled clips (without the raw performer versions).

How the clips are made (`tools/blender/`, run headless):

- `retarget_export.py` retargets the BVH takes in `clips.py` onto the Quaternius skeleton. For each mapped bone the world rotation change from a neutral standing frame of the performer is applied on top of the target bone's own rest orientation (`W_target = Rz * dW_src * Q_bone * W_rest`), so rest-pose offsets are preserved instead of copying absolute rotations. Clavicles keep the Quaternius rest orientation (no `Q_bone`), the ACCAD data has no finger motion so a relaxed hand is added, and loops are cut on gait cycles and cross-faded closed. `clips.py` also holds the gendered gait styling.
- `quaternius_retarget.py` imports `client/public/models/body-<sex>.glb` **with `guess_original_bind_pose=False`**. Blender's default re-derives a bind pose from the inverse bind matrices that does not match the mesh (about 6 cm off at the shoulders and wrists for these characters), which shows up as collapsed shoulders and sheared arms.
- `tools/build-character-clips.mjs` paints the uniform (`tools/uniform-painter.mjs`), compresses the GLBs and writes `client/dev-assets/characters/` (gallery) and `client/public/models` (game).

To regenerate the clips:

```bash
tools/blender/setup.sh                     # once: portable Blender 4.2 and the ACCAD BVH files into tools/.cache (about 1 GB)
cd tools && npm install && npm run build:clips
```

The pipeline takes about 20 s and writes the game's `clips-<sex>.glb`, `motion.json` and `uniform/` textures into `client/public/models` as well as the gallery assets. To change a clip, edit `tools/blender/clips.py` (take and frame range; `python3 tools/blender/find_loops.py` suggests loop points) and rebuild.

To rebuild the game's character assets (only needed when changing the pipeline):

```bash
cd tools && npm install && npm run build:characters
```

## Credits

- Character bodies, hair, beard and eyes: **[Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html)** by [Quaternius](https://quaternius.com), CC0 1.0.
- Motion: **[ACCAD Open Motion Project](https://accad.osu.edu/research/motion-lab/mocap-system-and-data)** motion capture (Female 1 and Male 1), CC BY 3.0. Motion capture data from ACCAD, The Ohio State University.

The license text ships in `client/public/models/LICENSE-quaternius.txt`. The ACCAD clips were cut into loops, retimed and retargeted to the Quaternius skeleton (`client/public/models/LICENSE-accad.txt`). CC0 doesn't require attribution, but credit is given anyway; consider supporting Quaternius on [Patreon](https://www.patreon.com/quaternius). The assets were modified: the skin textures were recolored (navy underwear, a shaven variant), hair textures were neutralized for tinting, the meshes were merged per body, and the stock clips were replaced by the retargeted mocap.
