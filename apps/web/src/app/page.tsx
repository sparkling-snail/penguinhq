"use client";

import dynamic from "next/dynamic";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useAgents } from "@/hooks/useAgents";

// PixiJS reaches for `window`/WebGL context at import time, so the game
// canvas must never be part of the server-rendered bundle. `ssr: false`
// is the one place in this app that opts out of SSR, and it's isolated
// to exactly the component that needs it.
const GameCanvas = dynamic(
  () => import("@/components/game/GameCanvas").then((m) => m.GameCanvas),
  { ssr: false }
);

function PenguinHQShell() {
  useWebSocket();
  useAgents();

  return (
    <main className="flex h-screen w-screen gap-3 p-3">
      <div className="min-w-0 flex-1">
        <GameCanvas />
      </div>
      <ChatSidebar />
    </main>
  );
}

export default function Home() {
  return (
    <QueryProvider>
      <PenguinHQShell />
    </QueryProvider>
  );
}
