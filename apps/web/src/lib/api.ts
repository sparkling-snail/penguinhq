import type { Agent } from "@/types/agent";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * Minimal fetch wrapper. React Query (wired in `hooks/`) is the caller in
 * every real component — this file stays a dumb HTTP client with no
 * caching/retry logic of its own so those concerns live in exactly one
 * place (React Query's config).
 */
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`API request failed: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listAgents: () => apiFetch<Agent[]>("/agents"),
  health: () => apiFetch<{ status: string }>("/health"),
};
