import type { Agent } from "@/types/agent";

/**
 * A deterministic roster keeps the public portfolio experience useful when
 * the private agent backend is offline or intentionally not exposed. Live API
 * data replaces these records as soon as it becomes available.
 */
export const DEMO_AGENTS: Agent[] = [
  {
    id: "job-hunter",
    name: "Job Hunter",
    role: "job_hunter",
    state: "searching",
    room: "engineering",
    position: { x: 65, y: 58 },
    avatarColor: "#F97316",
  },
  {
    id: "leetcode-coach",
    name: "Leetcode Coach",
    role: "leetcode_coach",
    state: "coding",
    room: "library",
    position: { x: 18, y: 75 },
    avatarColor: "#8B5CF6",
  },
  {
    id: "tech-scout",
    name: "Tech Scout",
    role: "tech_scout",
    state: "researching",
    room: "research_lab",
    position: { x: 39, y: 55 },
    avatarColor: "#EAB308",
  },
  {
    id: "portfolio",
    name: "Portfolio Penguin",
    role: "portfolio",
    state: "sleeping",
    room: "launch_pad",
    position: { x: 36, y: 89 },
    avatarColor: "#EC4899",
  },
];

export const IS_PUBLIC_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
