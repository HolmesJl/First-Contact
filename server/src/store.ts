import fs from 'node:fs';
import path from 'node:path';
import { upgradeLegacyCharacter, type Character } from '../../shared/protocol';
import type { QuestStep } from '../../shared/opening';

export interface MemberRecord {
  id: string;
  tube: number;
  character: Character | null;
  x: number;
  z: number;
  rot: number;
  joinedAt: number;
  isClone?: boolean;
  hasPad?: boolean;
  reportedIn?: boolean;
  questStep?: QuestStep;
  cloneTank?: number | null;
}

export interface ShipRecord {
  code: string;
  hostId: string;
  createdAt: number;
  members: Record<string, MemberRecord>;
  gameStarted?: boolean;
  gameStartedAt?: number | null;
  shipName?: string;
  transitYears?: number;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export class ShipStore {
  private ships = new Map<string, ShipRecord>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private file: string) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { ships?: ShipRecord[] };
      for (const s of raw.ships ?? []) {
        for (const m of Object.values(s.members)) if (m.character) upgradeLegacyCharacter(m.character as unknown as Record<string, unknown>);
        this.ships.set(s.code, s);
      }
      console.log(`[store] loaded ${this.ships.size} ship(s) from ${file}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[store] failed to load', err);
    }
  }

  get count() {
    return this.ships.size;
  }

  get(code: string) {
    return this.ships.get(code);
  }

  create(hostId: string): ShipRecord {
    let code = '';
    do {
      code = Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
    } while (this.ships.has(code));
    const ship: ShipRecord = { code, hostId, createdAt: Date.now(), members: {} };
    this.ships.set(code, ship);
    this.save();
    return ship;
  }

  /** Debounced write; the file is replaced atomically. */
  save(delay = 400) {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, delay);
  }

  flush() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ ships: [...this.ships.values()] }, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
