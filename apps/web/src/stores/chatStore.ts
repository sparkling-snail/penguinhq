import { create } from "zustand";
import type { ChatChannel, ChatMessage } from "@/types/chat";

/**
 * Milestone 1 note: the channel list and seed messages below are UI-only —
 * they establish the visual + interaction pattern for the Slack-like
 * communication center. Real messages start flowing once agents post
 * through the WebSocket `chat.message` event (wired in useWebSocket) and,
 * later, once agent task execution actually produces something to say.
 */

export const CHANNELS: ChatChannel[] = [
  { id: "general", label: "general", description: "Company-wide updates" },
  { id: "jobs", label: "jobs", description: "Job Hunter Penguin's findings" },
  { id: "engineering", label: "engineering", description: "Build + deploy chatter" },
  { id: "research", label: "research", description: "Tech Scout's research drops" },
  { id: "alerts", label: "alerts", description: "Incidents and warnings" },
  { id: "deployments", label: "deployments", description: "Release activity" },
  { id: "logs", label: "logs", description: "Raw agent activity log" },
  { id: "human", label: "human", description: "Direct line to you" },
];

const SEED_MESSAGES: ChatMessage[] = [
  {
    id: "seed-1",
    channel: "jobs",
    authorId: "job-hunter",
    authorName: "Job Hunter",
    authorColor: "#F97316",
    content: "Found 8 new AI Infrastructure jobs.",
    createdAt: new Date(Date.now() - 1000 * 60 * 6).toISOString(),
  },
  {
    id: "seed-2",
    channel: "jobs",
    authorId: "portfolio",
    authorName: "Portfolio Penguin",
    authorColor: "#EC4899",
    content: "I'll compare them against your resume.",
    createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
  },
  {
    id: "seed-3",
    channel: "jobs",
    authorId: "leetcode-coach",
    authorName: "Leetcode Coach",
    authorColor: "#8B5CF6",
    content: "Those companies frequently ask Graph questions.",
    createdAt: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
  },
  {
    id: "seed-4",
    channel: "research",
    authorId: "tech-scout",
    authorName: "Tech Scout",
    authorColor: "#EAB308",
    content: "Researching latest Kubernetes trends.",
    createdAt: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
  },
];

interface ChatState {
  channels: ChatChannel[];
  activeChannelId: string;
  messages: ChatMessage[];

  setActiveChannel: (id: string) => void;
  addMessage: (message: ChatMessage) => void;
  messagesForActiveChannel: () => ChatMessage[];
}

export const useChatStore = create<ChatState>((set, get) => ({
  channels: CHANNELS,
  activeChannelId: "jobs",
  messages: SEED_MESSAGES,

  setActiveChannel: (id) => set({ activeChannelId: id }),

  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),

  messagesForActiveChannel: () =>
    get().messages.filter((m) => m.channel === get().activeChannelId),
}));
