"use client";

import { useState } from "react";
import { useChatStore } from "@/stores/chatStore";
import { getPenguinSocket } from "@/lib/websocket";
import type { ChatMessage } from "@/types/chat";

/**
 * Sends a real `chat.message` WebSocket event (see
 * app/api/routes/websocket.py) which the backend fans out to every
 * connected client, including this tab — so the message you type
 * actually round-trips through the backend rather than being appended
 * to local state directly. There's no persistence behind it yet
 * (Milestone: communication center), so a page refresh clears history.
 */
export function MessageComposer() {
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const [draft, setDraft] = useState("");

  const send = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;

    const message: ChatMessage = {
      id: crypto.randomUUID(),
      channel: activeChannelId,
      authorId: "human",
      authorName: "You",
      authorColor: "#38bdf8",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    getPenguinSocket().send("chat.message", message);
    setDraft("");
  };

  return (
    <div className="flex items-center gap-2 border-t border-penguin-border p-2">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && send()}
        placeholder={`Message #${activeChannelId}`}
        className="flex-1 rounded-md border border-penguin-border bg-white/5 px-3 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-penguin-accent"
      />
      <button
        onClick={send}
        className="rounded-md bg-penguin-accent px-3 py-1.5 text-sm font-medium text-slate-900 transition-opacity hover:opacity-90"
      >
        Send
      </button>
    </div>
  );
}
