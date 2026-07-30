"use client";

import { useState } from "react";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { GameCanvas } from "@/components/game/GameCanvas";
import { ResizeHandle, DEFAULT_WIDTH } from "@/components/ResizeHandle";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useAgents } from "@/hooks/useAgents";

function PenguinHQShell() {
  useWebSocket();
  useAgents();

  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);

  return (
    <main className="flex h-screen w-screen p-3">
      <div className="flex min-w-0 flex-1 items-center justify-center">
        <GameCanvas />
      </div>
      <ResizeHandle sidebarWidth={sidebarWidth} onWidthChange={setSidebarWidth} />
      <ChatSidebar width={sidebarWidth} />
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
