"use client";

import { useState } from "react";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { GameCanvas } from "@/components/game/GameCanvas";
import { ResizeHandle, DEFAULT_WIDTH } from "@/components/ResizeHandle";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useAgents } from "@/hooks/useAgents";
import { LeetcodePracticeDesk } from "@/components/leetcode/LeetcodePracticeDesk";
import { PortfolioGuide } from "@/components/PortfolioGuide";

function PenguinHQShell() {
  useWebSocket();
  useAgents();

  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [practiceDeskOpen, setPracticeDeskOpen] = useState(false);

  return (
    <main className="flex h-[100dvh] w-screen flex-col gap-2 p-2 lg:flex-row lg:gap-0 lg:p-3">
      <PortfolioGuide />
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
        {practiceDeskOpen ? <LeetcodePracticeDesk onClose={() => setPracticeDeskOpen(false)} /> : <GameCanvas />}
      </div>
      <ResizeHandle sidebarWidth={sidebarWidth} onWidthChange={setSidebarWidth} />
      <ChatSidebar width={sidebarWidth} onOpenPracticeDesk={() => setPracticeDeskOpen(true)} />
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
