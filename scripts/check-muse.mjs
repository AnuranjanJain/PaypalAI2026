import { runMuseStructured } from "../src/lib/agents/muse.ts";

const contexts = {
  progress: {
    title: "Launch kit",
    acceptanceCriteria: ["Reviewed launch kit"],
    evidence: ["Milestone evidence is present."],
  },
  scope_shield: {
    baselineScope: { deliverables: ["Launch kit"] },
    requestedScope: { deliverables: ["Launch kit", "Mobile app"] },
  },
  dispute_shield: {
    statement: "The requested evidence and delivery note disagree.",
    evidence: ["Owner says the export is missing.", "Provider says the export was delivered."],
  },
  negotiation: {
    baselineScope: { deliverables: ["Launch kit"] },
    requestedScope: { deliverables: ["Launch kit", "Mobile app"] },
    requestedAmountCents: 15000,
  },
};

const results = await Promise.all(Object.entries(contexts).map(async ([agent, context]) => {
  const result = await runMuseStructured(agent, context);
  return { agent, mode: result.mode, model: result.model, validated: Boolean(result.value), errorCode: result.errorCode ?? null };
}));

for (const result of results) console.log(`${result.agent.padEnd(15)} ${result.mode.padEnd(20)} validated=${result.validated} model=${result.model}${result.errorCode ? ` error=${result.errorCode}` : ""}`);
if (results.some((result) => result.mode !== "ai-provider" || !result.validated)) {
  console.error("\nOne or more Meta Muse agents did not return validated provider output.");
  process.exitCode = 1;
} else {
  console.log("\nAll four Meta Muse agent contracts passed.");
}
