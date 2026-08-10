"use client";

import { useState } from "react";
import { useChatStore } from "@/stores/chatStore";
import { useGameStore } from "@/stores/gameStore";
import { getPenguinSocket } from "@/lib/websocket";
import { api } from "@/lib/api";
import type { ChatMessage } from "@/types/chat";

const OFFICE_MANAGER = {
  authorId: "office-manager",
  authorName: "Office Manager",
  authorColor: "#2dd4bf",
};

function officeReply(channel: string, content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    channel,
    ...OFFICE_MANAGER,
    content,
    createdAt: new Date().toISOString(),
  };
}

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
  const addMessage = useChatStore((s) => s.addMessage);
  const setAgents = useGameStore((s) => s.setAgents);
  const officeModeEnabled = useGameStore((s) => s.officeModeEnabled);
  const setOfficeModeEnabled = useGameStore((s) => s.setOfficeModeEnabled);
  const setOfficeTimeMode = useGameStore((s) => s.setOfficeTimeMode);
  const [draft, setDraft] = useState("");

  const runCommand = async (input: string): Promise<boolean> => {
    const [command = "", option] = input.toLowerCase().split(/\s+/, 2);
    if (!command.startsWith("/")) return false;

    if (command === "/status") {
      try {
        const [agents, tasks] = await Promise.all([api.listAgents(), api.listTasks()]);
        setAgents(agents);
        const working = agents.filter((agent) => !["idle", "waiting", "sleeping"].includes(agent.state));
        const openTasks = tasks.filter((task) => !["completed", "failed"].includes(task.status));
        addMessage(
          officeReply(
            activeChannelId,
            `Live status: ${working.length}/${agents.length} agents active; ${openTasks.length} open task${openTasks.length === 1 ? "" : "s"}. ${working.map((agent) => `${agent.name} (${agent.state})`).join(", ") || "The flock is on a break."}`
          )
        );
      } catch {
        addMessage(officeReply(activeChannelId, "I couldn't reach the live agent service. Try /status again in a moment."));
      }
      return true;
    }

    if (command === "/agents") {
      try {
        const agents = await api.listAgents();
        setAgents(agents);
        addMessage(
          officeReply(
            activeChannelId,
            agents.length
              ? agents.map((agent) => `${agent.name} — ${agent.role.replaceAll("_", " ")} (${agent.state})`).join("\n")
              : "No agents are registered yet."
          )
        );
      } catch {
        addMessage(officeReply(activeChannelId, "I couldn't load the agent roster right now."));
      }
      return true;
    }

    if (command === "/office") {
      if (option === "day" || option === "night" || option === "auto") {
        setOfficeModeEnabled(true);
        setOfficeTimeMode(option);
        addMessage(officeReply(activeChannelId, `Office ambience is on with ${option} lighting.`));
      } else if (option === "on") {
        setOfficeModeEnabled(true);
        addMessage(officeReply(activeChannelId, "Office ambience is on: routines, speech bubbles, and visual-only events are live."));
      } else if (option === "off") {
        setOfficeModeEnabled(false);
        addMessage(officeReply(activeChannelId, "Office ambience is off. Agents are still working normally."));
      } else {
        const next = !officeModeEnabled;
        setOfficeModeEnabled(next);
        addMessage(
          officeReply(
            activeChannelId,
            next
              ? "Office ambience is on: routines, speech bubbles, and visual-only events are live. Use /office day, /office night, or /office auto to set lighting."
              : "Office ambience is off. Agents are still working normally."
          )
        );
      }
      return true;
    }

    addMessage(officeReply(activeChannelId, "Unknown command. Try /status, /agents, or /office [on|off|day|night|auto]."));
    return true;
  };

  const send = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;

    if (await runCommand(trimmed)) {
      setDraft("");
      return;
    }

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
        onKeyDown={(e) => e.key === "Enter" && void send()}
        placeholder={`Message #${activeChannelId} — try /status`}
        className="flex-1 rounded-md border border-penguin-border bg-white/5 px-3 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-penguin-accent"
      />
      <button
        onClick={() => void send()}
        className="rounded-md bg-penguin-accent px-3 py-1.5 text-sm font-medium text-slate-900 transition-opacity hover:opacity-90"
      >
        Send
      </button>
    </div>
  );
}
