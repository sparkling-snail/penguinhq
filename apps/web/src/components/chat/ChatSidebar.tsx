"use client";

import { ChannelList } from "./ChannelList";
import { MessageList } from "./MessageList";
import { MessageComposer } from "./MessageComposer";
import { useChatStore } from "@/stores/chatStore";

interface ChatSidebarProps {
  width?: number;
}

/**
 * The Slack-like communication center — composed from three small
 * pieces (channel list, message list, composer) rather than one big
 * component, so each can grow independently as real backend events
 * start flowing through the communication-center milestone.
 */
export function ChatSidebar({ width = 320 }: ChatSidebarProps) {
  const activeChannelId = useChatStore((s) => s.activeChannelId);

  return (
    <aside className="glass-panel flex h-full shrink-0 flex-col" style={{ width }}>
      <div className="flex items-center justify-between border-b border-penguin-border px-3 py-2.5">
        <span className="text-sm font-semibold text-slate-100">PenguinHQ</span>
        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
          live
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-28 shrink-0 border-r border-penguin-border">
          <ChannelList />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-penguin-border px-3 py-2 text-sm font-medium text-slate-200">
            #{activeChannelId}
          </div>
          <MessageList />
          <MessageComposer />
        </div>
      </div>
    </aside>
  );
}
