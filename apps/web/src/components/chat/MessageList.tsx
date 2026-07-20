"use client";

import { useChatStore } from "@/stores/chatStore";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * UI-only for Milestone 1 — renders seed messages plus anything that
 * arrives over the WebSocket `chat.message` event (see useWebSocket).
 * There is no message persistence or send-to-backend wiring yet; that
 * lands with the Slack-like communication center milestone, where every
 * message here corresponds to a real backend event per the product spec.
 */
export function MessageList() {
  const messages = useChatStore((s) => s.messagesForActiveChannel());

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        No messages yet in this channel.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
      {messages.map((message) => (
        <div key={message.id} className="flex gap-2.5">
          <div
            className="mt-0.5 h-7 w-7 shrink-0 rounded-md"
            style={{ backgroundColor: message.authorColor }}
          />
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-slate-100">{message.authorName}</span>
              <span className="text-[10px] text-slate-500">{formatTime(message.createdAt)}</span>
            </div>
            <p className="break-words text-sm text-slate-300">{message.content}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
