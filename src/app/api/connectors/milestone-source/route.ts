import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/connectors/types";

const FILTER_KEYS = ["eventTypes", "resourceId", "branch", "pullRequest", "workflow", "versionId", "pageId", "frameId", "nodeId"] as const;

function sanitizeFilters(value: unknown): Record<string, unknown> | null {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of FILTER_KEYS) {
    const candidate = source[key];
    if (candidate === undefined || candidate === null || candidate === "") continue;
    if (key === "eventTypes") {
      if (!Array.isArray(candidate) || candidate.length > 20 || candidate.some((item) => typeof item !== "string" || item.length > 120)) return null;
      result[key] = candidate.map((item) => item.trim()).filter(Boolean);
      continue;
    }
    if (typeof candidate !== "string" || candidate.trim().length > 200) return null;
    result[key] = candidate.trim();
  }
  return result;
}

export async function POST(request: Request) {
  let body: { pactId?: unknown; milestoneId?: unknown; connectionId?: unknown; filters?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  if (!isUuid(body.pactId) || !isUuid(body.milestoneId) || !isUuid(body.connectionId)) return NextResponse.json({ error: "Pact, milestone, and connection are required." }, { status: 400 });
  const filters = sanitizeFilters(body.filters);
  if (!filters) return NextResponse.json({ error: "Filters must contain only supported scope values." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to map a milestone source." }, { status: 401 });
  const { data: mappingId, error } = await supabase.rpc("attach_pact_milestone_source", {
    target_pact: body.pactId,
    target_milestone: body.milestoneId,
    target_connection: body.connectionId,
    target_filters: filters,
  });
  if (error) return NextResponse.json({ error: error.message.includes("Owner") ? error.message : "Milestone source could not be mapped." }, { status: 403 });
  return NextResponse.json({ mappingId, pactId: body.pactId, milestoneId: body.milestoneId, connectionId: body.connectionId, enabled: true });
}
