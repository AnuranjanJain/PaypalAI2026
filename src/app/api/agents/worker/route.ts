import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { executeAgentRun } from "@/lib/agents/runtime";
import { createAgentAdminClient } from "@/lib/agents/supabase-admin";

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

function secretsMatch(expected: string, supplied: string | null): boolean {
  if (!supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function batchSize(): number {
  const configured = Number(process.env.AGENT_BATCH_SIZE ?? 12);
  return Number.isFinite(configured) ? Math.max(1, Math.min(50, Math.floor(configured))) : 12;
}

async function nextQueuedRun(supabase: ReturnType<typeof createAgentAdminClient>): Promise<string | null> {
  const expiredBefore = new Date().toISOString();
  const { data, error } = await supabase
    .from("agent_runs")
    .select("id")
    .or(`status.eq.queued,and(status.eq.running,lease_until.lt.${expiredBefore})`)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Agent queue is unavailable.");
  return validId(data?.id) ? data.id : null;
}

export async function POST(request: Request) {
  const configuredSecret = process.env.AGENT_WORKER_SECRET ?? process.env.CRON_SECRET;
  const suppliedSecret = request.headers.get("x-agent-worker-secret") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!configuredSecret || !secretsMatch(configuredSecret, suppliedSecret)) {
    return NextResponse.json({ error: "Worker authorization failed." }, { status: 401 });
  }

  let body: { runId?: unknown } = {};
  try {
    const parsed: unknown = await request.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as { runId?: unknown };
  } catch {
    // An empty body means claim the oldest queued run.
  }

  try {
    const supabase = createAgentAdminClient();
    const requestedRunId = validId(body.runId) ? body.runId : null;
    if (requestedRunId) {
      const result = await executeAgentRun(requestedRunId, supabase);
      return NextResponse.json({ runId: requestedRunId, status: result.status, mode: result.mode, error: result.error });
    }

    const results: Array<{ runId: string; status: string; mode?: string; error?: string }> = [];
    for (let index = 0; index < batchSize(); index += 1) {
      const runId = await nextQueuedRun(supabase);
      if (!runId) break;
      const result = await executeAgentRun(runId, supabase);
      results.push({ runId, status: result.status, mode: result.mode, error: result.error });
    }
    return NextResponse.json({ status: results.length ? "processed" : "empty", processed: results.length, results });
  } catch {
    return NextResponse.json({ error: "Agent worker storage is unavailable." }, { status: 503 });
  }
}

// Vercel Cron invokes the configured path with GET; keep POST available for local/manual runs.
export async function GET(request: Request) {
  return POST(request);
}
