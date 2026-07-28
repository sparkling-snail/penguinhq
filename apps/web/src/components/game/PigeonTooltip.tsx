import type { PigeonInFlight } from "@/stores/gameStore";

const STATUS_LABEL: Record<PigeonInFlight["status"], string> = {
  success: "🟢 Success",
  retry: "🟡 Retry",
  dead_letter: "🔴 Dead Letter Queue",
  high_priority: "🔵 High Priority",
  ai_collab: "🟣 AI Collaboration",
};

/**
 * Hover card for a Kafka-pigeon in flight — surfaces exactly the fields
 * called out in the product spec: task id, source/destination, priority,
 * latency, retries, queue, payload size, and status.
 */
export function PigeonTooltip({ data }: { data: PigeonInFlight }) {
  return (
    <div className="glass-panel pointer-events-none absolute right-3 top-3 w-64 p-3 text-xs">
      <div className="mb-2 font-semibold text-slate-100">{STATUS_LABEL[data.status]}</div>
      <dl className="space-y-1 text-slate-300">
        <Row label="Task ID" value={data.task_id} />
        <Row label="Source" value={data.source_agent_id} />
        <Row label="Destination" value={data.destination_agent_id} />
        <Row label="Priority" value={data.priority} />
        <Row label="Latency" value={`${data.latency_ms} ms`} />
        <Row label="Retries" value={String(data.retries)} />
        <Row label="Queue" value={data.queue} />
        <Row label="Payload" value={`${data.payload_size_bytes} B`} />
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}
