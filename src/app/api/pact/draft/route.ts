import { NextResponse } from "next/server";

type DraftRequest = {
  title?: unknown;
  brief?: unknown;
  budget?: unknown;
  schedule?: unknown;
};

type PactDraft = {
  id: string;
  title: string;
  brief: string;
  budget: number;
  schedule: number[];
  status: "draft";
  createdAt: string;
};

const drafts = new Map<string, PactDraft>();

function validationError(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: Request) {
  let body: DraftRequest;
  try {
    body = await request.json() as DraftRequest;
  } catch {
    return validationError("Request body must be valid JSON.");
  }

  if (typeof body.title !== "string" || body.title.trim().length < 3 || body.title.trim().length > 120) {
    return validationError("Title must be between 3 and 120 characters.");
  }
  if (typeof body.brief !== "string" || body.brief.trim().length < 10 || body.brief.trim().length > 2000) {
    return validationError("Brief must be between 10 and 2,000 characters.");
  }

  const budget = typeof body.budget === "number" ? body.budget : Number(body.budget);
  if (!Number.isFinite(budget) || budget <= 0 || budget > 1_000_000) {
    return validationError("Budget must be a number greater than 0 and no more than 1,000,000.");
  }

  if (!Array.isArray(body.schedule) || body.schedule.length < 2 || body.schedule.length > 12) {
    return validationError("Schedule must contain between 2 and 12 milestones.");
  }
  const schedule = body.schedule.map((value) => typeof value === "number" ? value : Number(value));
  if (schedule.some((value) => !Number.isInteger(value) || value <= 0 || value > 100)) {
    return validationError("Each milestone percentage must be a whole number between 1 and 100.");
  }
  if (schedule.reduce((sum, value) => sum + value, 0) !== 100) {
    return validationError("Milestone percentages must add up to 100%.");
  }

  const id = `pact_${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const draft: PactDraft = {
    id,
    title: body.title.trim(),
    brief: body.brief.trim(),
    budget: Math.round(budget * 100) / 100,
    schedule,
    status: "draft",
    createdAt: new Date().toISOString(),
  };
  drafts.set(id, draft);

  return NextResponse.json({ draft, mode: "in-memory-demo" }, { status: 201 });
}
