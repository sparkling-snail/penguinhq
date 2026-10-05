"use client";

import { ChannelList } from "./ChannelList";
import { MessageList } from "./MessageList";
import { MessageComposer } from "./MessageComposer";
import { useChatStore } from "@/stores/chatStore";

interface ChatSidebarProps {
  width?: number;
  onOpenPracticeDesk?: () => void;
}

/**
 * The Slack-like communication center — composed from three small
 * pieces (channel list, message list, composer) rather than one big
 * component, so each can grow independently as real backend events
 * start flowing through the communication-center milestone.
 */
export function ChatSidebar({ width = 320, onOpenPracticeDesk }: ChatSidebarProps) {
  const activeChannelId = useChatStore((s) => s.activeChannelId);

  return (
    <aside className="glass-panel flex h-[40dvh] shrink-0 flex-col max-lg:!w-full lg:h-full" style={{ width }}>
      <div className="flex items-center justify-between gap-2 border-b border-penguin-border px-3 py-2.5">
        <span className="text-sm font-semibold text-slate-100">PenguinHQ</span>
        <div className="flex items-center gap-1.5">
          {activeChannelId === "leetcode" && (
            <button
              type="button"
              onClick={onOpenPracticeDesk}
              className="rounded-md bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium text-violet-300 transition-colors hover:bg-violet-500/25"
            >
              &lt;/&gt; practice
            </button>
          )}
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
            live
          </span>
        </div>
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
