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

- `W` `A` `S` `D` or arrow keys to move, `Shift` to run
- Drag to orbit the camera, scroll to zoom
- `Space`, `Enter`, or `Esc` skips the intro
- On touch devices, an on-screen joystick appears after you create your character

### Other scripts

```bash
npm run typecheck   # server + client
npm run build       # production build of the client into client/dist
```

Environment variables: `PORT` (server port, default `47322`), `DATA_FILE` (save file path), `SERVER_PORT` (tells the Vite proxy where the server is), and `ALLOWED_HOSTS` (extra comma-separated hostnames the dev server accepts).

## Layout

```
shared/     protocol types, job caps and validation, clone lab layout (used by client and server)
server/     Node WebSocket server: ships, membership, character creation, movement relay, JSON persistence
client/     Vite + TypeScript + Three.js
  src/scene/intro.ts      Earth, Moon, rocket launch and rendezvous cinematic (also the title backdrop)
  src/scene/ship.ts       the First Contact ship model
  src/scene/lab.ts        clone lab, tubes, players, movement, camera
  src/scene/character.ts  rigged glTF characters: appearance, procedural expressions, animation
  public/models/          built character assets (see Credits)
  gallery.html            dev-only expression gallery: /gallery.html?view=close or ?view=game
  characters.html         dev-only character pipeline spike (MPFB + mocap vs current): /characters.html
  dev-assets/mpfb/        spike character assets (not part of the game build)
tools/      offline asset pipeline (build-characters.mjs); not needed to run the game
  src/ui.ts               title screen, HUD, character creator, joystick
```

## Networking model

The server is authoritative for membership, job assignment, character data, and spawn position. Movement is client-predicted: clients send position at 15 Hz, the server clamps it to the lab bounds, and it broadcasts snapshots at about 15 Hz. Remote players are smoothed on the client.

## Characters

Clones are rigged, low/mid-poly glTF models (about 7k vertices each) sharing one UE-style skeleton, with idle, walk and jog clips crossfaded by speed. The base meshes have no facial rig, so the four expressions are procedural morph targets. They are generated at load time around mouth, eye, and brow landmarks found through the painted face texture's UVs:

- **Smiling:** raised mouth corners and cheeks, lifted brows.
- **Serious:** pressed lips and a slight furrow.
- **Angry:** a frown, brows pulled down and in, narrowed eyes.
- **Flirty:** a one-sided smirk, heavy lids, one raised brow, and the occasional wink.

Everyone blinks. Hair, beard, and eyes are tinted per character; "no facial hair" swaps to a clean-shaven skin texture.

### Character pipeline spike (dev only)

`/characters.html` (run `npm run dev -w client`) shows the current Quaternius characters next to realistic MakeHuman / MPFB characters (about 9.8k body vertices, ARKit blendshape faces, tintable hair/eyes/skin) animated with gendered motion capture, with idle / walk / jog / sprint toggles and an orbit camera. The game itself does not use any of it. Findings and the migration estimate are in the spike notes (`docs/character-spike.md` in the project store); the pipeline lives in `tools/blender/` and `tools/build-mpfb-characters.mjs`:

```bash
tools/blender/setup.sh                    # one-time: Blender, MPFB, CC0 asset packs, ACCAD mocap -> tools/.cache
cd tools && npm install && npm run build:mpfb
```

To rebuild the assets (only needed when changing the pipeline):

```bash
cd tools && npm install && npm run build:characters
```

## Credits

- Character bodies, hair, beard and eyes: **[Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html)** by [Quaternius](https://quaternius.com), CC0 1.0.
- Animations: **[Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html)** by Quaternius, CC0 1.0.

The license text ships in `client/public/models/LICENSE-quaternius.txt`. The spike assets in `client/dev-assets/mpfb` are CC0 (MakeHuman) plus motion from the ACCAD Open Motion Project, CC BY 3.0; see `client/dev-assets/mpfb/LICENSES.txt`. CC0 doesn't require attribution, but credit is given anyway; consider supporting Quaternius on [Patreon](https://www.patreon.com/quaternius). The assets were modified: the skin textures were recolored (navy underwear, a shaven variant), hair textures were neutralized for tinting, the meshes were merged per body, and the clips were trimmed.
