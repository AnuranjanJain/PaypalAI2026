export type PactDraftInput = {
  title: string;
  brief: string;
  budgetCents: number;
  milestones: { title: string; amountCents: number }[];
};

type RawPactDraftInput = {
  title?: unknown;
  brief?: unknown;
  budget?: unknown;
  milestoneTitles?: unknown;
  milestoneAmounts?: unknown;
};

function parseUsdToCents(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,7}(?:\.\d{1,2})?$/.test(value)) return null;
  const [dollars, cents = ""] = value.split(".");
  const amount = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 100_000_000 ? amount : null;
}

export function parsePactDraftInput(input: RawPactDraftInput): PactDraftInput | null {
  if (typeof input.title !== "string" || typeof input.brief !== "string") return null;
  const title = input.title.trim();
  const brief = input.brief.trim();
  const budgetCents = parseUsdToCents(input.budget);
  if (title.length < 3 || title.length > 120 || brief.length < 10 || brief.length > 2000 || !budgetCents) return null;
  if (!Array.isArray(input.milestoneTitles) || !Array.isArray(input.milestoneAmounts) || input.milestoneTitles.length !== 4 || input.milestoneAmounts.length !== 4) return null;

  const milestones: PactDraftInput["milestones"] = [];
  for (let index = 0; index < 4; index += 1) {
    const rawTitle = input.milestoneTitles[index];
    const amountCents = parseUsdToCents(input.milestoneAmounts[index]);
    if (typeof rawTitle !== "string" || rawTitle.trim().length < 3 || rawTitle.trim().length > 120 || !amountCents) return null;
    milestones.push({ title: rawTitle.trim(), amountCents });
  }

  if (milestones.reduce((total, milestone) => total + milestone.amountCents, 0) !== budgetCents) return null;
  return { title, brief, budgetCents, milestones };
}
