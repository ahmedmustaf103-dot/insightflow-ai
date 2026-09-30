import { AnalysisFailure } from "@/lib/analysis/errors";
import type { AnalysisResult, DatasetProfile } from "@/lib/analysis/types";

const CLAIM_PATTERN = /[£$€]?\s*-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?/g;

type Claim = {
  raw: string;
  value: number;
  decimalPlaces: number;
  percent: boolean;
};

export function verifyClaims(input: {
  answer: string;
  result: AnalysisResult;
  profile: DatasetProfile;
}): void {
  const claims = extractClaims(maskLabels(input.answer, input.result));
  if (claims.length === 0) {
    return;
  }

  const evidence = evidenceNumbers(input.result, input.profile);
  const unmatched = claims.filter((claim) => !claimMatches(claim, evidence)).map((claim) => claim.raw.trim());
  if (unmatched.length === 0) {
    return;
  }

  throw new AnalysisFailure({
    stage: "verify-claims",
    message: `Explanation contains a number that is not in the analysis result: ${unmatched.join(", ")}.`,
    details: { code: "ungrounded_claim", claims: unmatched },
  });
}

function maskLabels(answer: string, result: AnalysisResult): string {
  const labels = new Set<string>();
  for (const row of result.rows) {
    for (const value of Object.values(row)) {
      if (typeof value === "string" && /\d/.test(value)) {
        labels.add(value);
      }
    }
  }

  return [...labels]
    .sort((left, right) => right.length - left.length)
    .reduce((text, label) => text.split(label).join(" "), answer);
}

function extractClaims(answer: string): Claim[] {
  return [...answer.matchAll(CLAIM_PATTERN)].flatMap((match) => {
    const claim = parseClaim(match[0]);
    return claim ? [claim] : [];
  });
}

function parseClaim(raw: string): Claim | null {
  const percent = raw.trim().endsWith("%");
  const cleaned = raw.replace(/[%£$€\s,]/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) {
    return null;
  }

  const decimals = cleaned.split(".")[1];
  return {
    raw,
    value: Number(cleaned),
    decimalPlaces: decimals?.length ?? 0,
    percent,
  };
}

function evidenceNumbers(result: AnalysisResult, profile: DatasetProfile): number[] {
  const numbers = [profile.rowCount, result.rowCount];
  for (const row of result.rows) {
    for (const value of Object.values(row)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        numbers.push(value);
      } else if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)) {
        numbers.push(Number(value));
      }
    }
  }
  return numbers;
}

function claimMatches(claim: Claim, evidence: number[]): boolean {
  const targets = claim.percent
    ? [
        { value: claim.value, decimalPlaces: claim.decimalPlaces },
        { value: claim.value / 100, decimalPlaces: Math.max(claim.decimalPlaces + 2, 2) },
      ]
    : [{ value: claim.value, decimalPlaces: claim.decimalPlaces }];

  return targets.some((target) =>
    evidence.some((value) => {
      if (!Number.isFinite(value)) {
        return false;
      }
      if (Math.abs(value - target.value) <= 1e-9) {
        return true;
      }
      return Math.abs(Number(value.toFixed(target.decimalPlaces)) - target.value) <= 1e-9;
    }),
  );
}
