"use client";

import { clsx } from "clsx";
import { useChatStore } from "@/stores/chatStore";

export function ChannelList() {
  const channels = useChatStore((s) => s.channels);
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const setActiveChannel = useChatStore((s) => s.setActiveChannel);

  return (
    <nav className="flex flex-col gap-0.5 overflow-y-auto p-2">
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Channels
      </div>
      {channels.map((channel) => (
        <button
          key={channel.id}
          onClick={() => setActiveChannel(channel.id)}
          title={channel.description}
          className={clsx(
            "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
            channel.id === activeChannelId
              ? "bg-penguin-accent/15 text-penguin-accent"
              : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
          )}
        >
          <span className="text-slate-600">#</span>
          {channel.label}
        </button>
      ))}
    </nav>
  );
}
