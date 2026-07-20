"use client";

import { useEffect } from "react";
import { getPenguinSocket } from "@/lib/websocket";
import { useGameStore } from "@/stores/gameStore";
import { useChatStore } from "@/stores/chatStore";
import type { PigeonPayload } from "@/types/events";
import type { ChatMessage } from "@/types/chat";

/**
 * Mounts the shared WebSocket connection and fans incoming events out to
 * the relevant Zustand store. This is the ONLY place that translates
 * "backend event" into "app state" — components never touch the socket
 * directly, they just read from useGameStore / useChatStore.
 *
 * Mount this once, high in the tree (see app/page.tsx).
 */
export function useWebSocket(): void {
  const addPigeon = useGameStore((s) => s.addPigeon);
  const removePigeon = useGameStore((s) => s.removePigeon);
  const addMessage = useChatStore((s) => s.addMessage);

  useEffect(() => {
    const socket = getPenguinSocket();
    socket.connect();

    const unsubscribe = socket.subscribe((event) => {
      switch (event.type) {
        case "pigeon.dispatched": {
          const payload = event.payload as PigeonPayload;
          addPigeon(payload);
          // Pigeons are a placeholder animation for now — auto-clear
          // after a flight duration so the list doesn't grow forever.
          setTimeout(() => removePigeon(payload.task_id), 8000);
          break;
        }
        case "chat.message": {
          addMessage(event.payload as ChatMessage);
          break;
        }
        case "connection.ack":
          // eslint-disable-next-line no-console
          console.info("[penguinhq] connected to backend");
          break;
        default:
          break;
      }
    });

    return () => {
      unsubscribe();
      socket.disconnect();
    };
  }, [addPigeon, removePigeon, addMessage]);
}
