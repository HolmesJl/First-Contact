import type { ClientMsg, ServerMsg } from '../../shared/protocol';

export class Net {
  private ws: WebSocket;
  private handlers = new Set<(m: ServerMsg) => void>();
  onClose: (() => void) | null = null;
  readonly ready: Promise<void>;

  constructor() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', () => reject(new Error('Could not reach the ship server. Is it running?')), { once: true });
    });
    this.ws.addEventListener('message', (e) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      this.handlers.forEach((h) => h(msg));
    });
    this.ws.addEventListener('close', () => this.onClose?.());
  }

  send(msg: ClientMsg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  on(handler: (m: ServerMsg) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close() {
    this.onClose = null;
    this.ws.close();
  }
}
