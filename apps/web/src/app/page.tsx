"use client";

import { QueryProvider } from "@/components/providers/QueryProvider";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { GameCanvas } from "@/components/game/GameCanvas";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useAgents } from "@/hooks/useAgents";

function PenguinHQShell() {
  useWebSocket();
  useAgents();

  return (
    <main className="flex h-screen w-screen gap-3 p-3">
      <div className="flex min-w-0 flex-1 items-center justify-center">
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
