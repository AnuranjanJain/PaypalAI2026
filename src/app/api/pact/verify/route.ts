import { NextResponse } from "next/server";
import { validateMilestoneInput, verifyMilestone, verifyMilestoneWithProvider } from "@/lib/pact";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const input = validateMilestoneInput(body);
  if (!input) return NextResponse.json({ error: "title, acceptanceCriteria, and evidence are invalid." }, { status: 400 });
  const providerResult = await verifyMilestoneWithProvider(input);
  return NextResponse.json({ verification: providerResult ?? verifyMilestone(input), mode: providerResult ? "ai-provider" : "demo-fallback" });
}
