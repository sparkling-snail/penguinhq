import type { WSEvent, WSEventType } from "@/types/events";

type Listener = (event: WSEvent) => void;

/**
 * Thin reconnecting WebSocket wrapper.
 *
 * Deliberately framework-agnostic (no React inside this file) so it can be
 * unit tested and reused outside of `useWebSocket`. Reconnection uses a
 * capped exponential backoff so a backend restart during `docker compose
 * up` doesn't spam the console or hammer the server.
 */
export class PenguinSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private reconnectAttempts = 0;
  private readonly clientId: string;
  private readonly url: string;
  private closedByClient = false;

  constructor(baseUrl: string) {
    this.clientId = PenguinSocket.getOrCreateClientId();
    this.url = `${baseUrl}/${this.clientId}`;
  }

  private static getOrCreateClientId(): string {
    if (typeof window === "undefined") return "server";
    const key = "penguinhq_client_id";
    let id = window.sessionStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      window.sessionStorage.setItem(key, id);
    }
    return id;
  }

  connect(): void {
    this.closedByClient = false;
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (raw) => {
      try {
        const event = JSON.parse(raw.data) as WSEvent;
        this.listeners.forEach((listener) => listener(event));
      } catch {
        // Malformed frame — ignore rather than crash the socket handler.
      }
    };

    this.ws.onclose = () => {
      if (this.closedByClient) return;
      const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15000);
      this.reconnectAttempts += 1;
      setTimeout(() => this.connect(), delay);
    };
  }

  disconnect(): void {
    this.closedByClient = true;
    this.ws?.close();
  }

  send(type: WSEventType, payload: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type, payload }));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

let singleton: PenguinSocket | null = null;

/** One shared socket per browser tab, lazily created. */
export function getPenguinSocket(): PenguinSocket {
  if (!singleton) {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws";
    singleton = new PenguinSocket(wsUrl);
  }
  return singleton;
}
