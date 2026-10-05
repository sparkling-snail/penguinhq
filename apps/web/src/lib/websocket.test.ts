import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PenguinSocket } from "./websocket";

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.onclose?.();
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
}

describe("PenguinSocket", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reuses one client id per browser tab", () => {
    const first = new PenguinSocket("ws://api/ws");
    const second = new PenguinSocket("ws://api/ws");
    first.connect();
    second.connect();

    const [a, b] = FakeWebSocket.instances;
    expect(a?.url).toBe(b?.url);
    expect(a?.url).toMatch(/^ws:\/\/api\/ws\/.+/);
  });

  it("delivers parsed events to subscribers and ignores malformed frames", () => {
    const socket = new PenguinSocket("ws://api/ws");
    const listener = vi.fn();
    socket.subscribe(listener);
    socket.connect();
    const ws = FakeWebSocket.instances[0]!;

    ws.onmessage?.({ data: "not json" });
    ws.onmessage?.({ data: JSON.stringify({ type: "chat.message", payload: { text: "hi" } }) });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ type: "chat.message", payload: { text: "hi" } });
  });

  it("stops notifying after unsubscribe", () => {
    const socket = new PenguinSocket("ws://api/ws");
    const listener = vi.fn();
    const unsubscribe = socket.subscribe(listener);
    socket.connect();
    unsubscribe();

    FakeWebSocket.instances[0]!.onmessage?.({ data: JSON.stringify({ type: "x", payload: null }) });

    expect(listener).not.toHaveBeenCalled();
  });

  it("only sends while the socket is open", () => {
    const socket = new PenguinSocket("ws://api/ws");
    socket.connect();
    const ws = FakeWebSocket.instances[0]!;

    socket.send("chat.message", { text: "early" });
    ws.open();
    socket.send("chat.message", { text: "ok" });

    expect(ws.sent).toEqual([JSON.stringify({ type: "chat.message", payload: { text: "ok" } })]);
  });

  it("reconnects with capped exponential backoff after an unexpected close", () => {
    const socket = new PenguinSocket("ws://api/ws");
    socket.connect();

    FakeWebSocket.instances[0]!.onclose?.();
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    FakeWebSocket.instances[1]!.onclose?.();
    vi.advanceTimersByTime(2000);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it("does not reconnect after a client-initiated disconnect", () => {
    const socket = new PenguinSocket("ws://api/ws");
    socket.connect();

    socket.disconnect();
    vi.advanceTimersByTime(60_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
