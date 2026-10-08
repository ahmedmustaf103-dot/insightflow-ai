import { AnalysisFailure } from "@/lib/analysis/errors";
import type { AnalysisPlan, ColumnProfile, DatasetProfile, Filter, Metric } from "@/lib/analysis/types";

const ARTICLES = new Set(["a", "an", "the", "our", "my", "your", "their"]);
const GENERIC = new Set([
  "order",
  "orders",
  "record",
  "records",
  "row",
  "rows",
  "entry",
  "entries",
  "item",
  "items",
  "data",
  "result",
  "results",
  "value",
  "values",
  "name",
  "names",
  "thing",
  "things",
  "amount",
  "amounts",
]);
const SKIP = new Set([
  "was",
  "were",
  "be",
  "been",
  "being",
  "did",
  "does",
  "do",
  "had",
  "have",
  "has",
  "placed",
  "generated",
  "generate",
  "change",
  "changed",
  "using",
  "use",
  "with",
  "and",
  "or",
  "to",
  "from",
  "on",
  "at",
  "into",
  "during",
  "between",
  "than",
  "then",
  "that",
  "this",
  "these",
  "those",
  "there",
  "please",
  "many",
  "much",
  "most",
  "least",
  "top",
  "best",
  "worst",
  "each",
  "every",
  "all",
  "me",
  "us",
]);

const AGGREGATIONS: Record<string, Metric["agg"]> = {
  total: "sum",
  sum: "sum",
  average: "mean",
  avg: "mean",
  mean: "mean",
  minimum: "min",
  min: "min",
  maximum: "max",
  max: "max",
  count: "count",
};

const GRAINS: Record<string, NonNullable<AnalysisPlan["grain"]>> = {
  month: "month",
  months: "month",
  monthly: "month",
  quarter: "quarter",
  quarters: "quarter",
  quarterly: "quarter",
  year: "year",
  years: "year",
  yearly: "year",
};

type RequestedRole = "metric" | "dimension" | "filter";

type RequestedValue = {
  column?: string;
  value: string;
};

type RequestedMetric = {
  column: string;
  agg?: Metric["agg"];
};

type QuestionRequest = {
  unsupported?: { role: RequestedRole; concept: string };
  metrics: RequestedMetric[];
  dimensions: string[];
  filterColumns: string[];
  mentions: string[];
  values: RequestedValue[];
  grain?: NonNullable<AnalysisPlan["grain"]>;
  years: string[];
  comparisons: string[];
  countRows: boolean;
};

type Noun =
  | { kind: "year" }
  | { kind: "skip" }
  | { kind: "column"; column: ColumnProfile }
  | { kind: "value"; column?: string; value: string }
  | { kind: "missing"; concept: string };

export function preserveIntent(question: string, plan: AnalysisPlan, profile: DatasetProfile): void {
  const request = readQuestion(question, profile);
  if (request.unsupported) {
    throw unsupported(request.unsupported.role, request.unsupported.concept);
  }

  const problem = unmetRequest(request, plan, profile);
  if (problem) {
    throw new AnalysisFailure({
      stage: "validate-plan",
      message: problem,
      details: { code: "intent_mismatch", publicMessage: problem },
    });
  }
}

function readQuestion(question: string, profile: DatasetProfile): QuestionRequest {
  const text = question.toLowerCase();
  const tokens = text.match(/[a-z0-9]+/g) ?? [];
  const request: QuestionRequest = {
    metrics: [],
    dimensions: [],
    filterColumns: [],
    mentions: [],
    values: [],
    years: [],
    comparisons: [],
    countRows: /\bhow many\b|\bnumber of\b|\bcount of\b/.test(text),
    grain: requestedGrain(text),
  };

  for (const column of profile.columns) {
    if (mentionsColumn(tokens, column)) {
      request.mentions.push(column.name);
    }
  }

  for (const match of text.matchAll(/\b(?:19|20)\d{2}\b/g)) {
    request.years.push(match[0]);
  }

  for (const match of text.matchAll(
    /\b(?:greater|less|more|fewer|higher|lower)\s+than\s+(\d+(?:\.\d+)?)\b|\b(?:above|below|over|under)\s+(\d+(?:\.\d+)?)\b/g,
  )) {
    const value = match[1] ?? match[2];
    if (value) request.comparisons.push(value);
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    if (token === "by" || token === "per") {
      readBy(tokens, index + 1, profile, request);
    } else if (token === "which" || token === "show" || token === "list") {
      readSubject(token, tokens, index + 1, profile, request);
    } else if (token === "for" || token === "in") {
      readConstraint(tokens, index + 1, profile, request);
    } else if (AGGREGATIONS[token]) {
      readAggregation(token, tokens, index + 1, profile, request);
    } else if (token === "what" && (tokens[index + 1] === "is" || tokens[index + 1] === "was")) {
      readWhat(tokens, index + 2, profile, request);
    } else if (token === "most" || token === "highest" || token === "lowest" || token === "least" || token === "top") {
      readRanking(token, tokens, index + 1, profile, request);
    }
  }

  if (request.grain && !request.unsupported && !profile.columns.some((column) => column.type === "date")) {
    request.unsupported = { role: "dimension", concept: "date" };
  }

  return request;
}

function readBy(tokens: string[], start: number, profile: DatasetProfile, request: QuestionRequest): void {
  const content = contentAt(tokens, start);
  if (!content) return;
  const next = tokens[content.index + 1];
  const phrase = next ? matchPhrase(`${content.word} ${next}`, profile) : undefined;
  if (!phrase && GRAINS[content.word] && !matchColumn(content.word, profile)) {
    request.grain = GRAINS[content.word];
    return;
  }

  const noun = readNoun(tokens, start, profile);
  if (noun.kind === "column") {
    if (noun.column.type === "number") {
      request.metrics.push({ column: noun.column.name });
    } else if (noun.column.type === "date") {
      request.mentions.push(noun.column.name);
    } else {
      request.dimensions.push(noun.column.name);
    }
    return;
  }
  if (noun.kind === "missing") {
    rememberUnsupported(request, "dimension", noun.concept);
  }
}

function readSubject(
  slot: "which" | "show" | "list",
  tokens: string[],
  start: number,
  profile: DatasetProfile,
  request: QuestionRequest,
): void {
  const noun = readNoun(tokens, start, profile);
  if (noun.kind === "column") {
    if (noun.column.type === "number") {
      request.metrics.push({ column: noun.column.name });
    } else if (slot === "which") {
      request.dimensions.push(noun.column.name);
    } else {
      request.mentions.push(noun.column.name);
    }
    return;
  }
  if (noun.kind === "missing") {
    rememberUnsupported(request, slot === "which" ? "dimension" : "metric", noun.concept);
  }
}

function readConstraint(tokens: string[], start: number, profile: DatasetProfile, request: QuestionRequest): void {
  const noun = readNoun(tokens, start, profile);
  if (noun.kind === "column") {
    request.filterColumns.push(noun.column.name);
    return;
  }
  if (noun.kind === "value") {
    request.values.push({ column: noun.column, value: noun.value });
    return;
  }
  if (noun.kind === "missing") {
    rememberUnsupported(request, "filter", noun.concept);
  }
}

function readAggregation(
  token: string,
  tokens: string[],
  start: number,
  profile: DatasetProfile,
  request: QuestionRequest,
): void {
  const agg = AGGREGATIONS[token];
  if (!agg) return;
  const noun = readNoun(tokens, start, profile);
  if (noun.kind === "skip" || noun.kind === "year") {
    if (agg === "count") request.countRows = true;
    return;
  }
  if (noun.kind === "column") {
    request.metrics.push({ column: noun.column.name, agg });
    return;
  }
  if (noun.kind === "missing") {
    rememberUnsupported(request, "metric", noun.concept);
  }
}

function readWhat(tokens: string[], start: number, profile: DatasetProfile, request: QuestionRequest): void {
  const noun = readNoun(tokens, start, profile);
  if (noun.kind === "column" && noun.column.type === "number") {
    request.metrics.push({ column: noun.column.name });
    return;
  }
  if (noun.kind === "column") {
    request.mentions.push(noun.column.name);
    return;
  }
  if (noun.kind === "missing") {
    rememberUnsupported(request, "metric", noun.concept);
  }
}

function readRanking(
  token: string,
  tokens: string[],
  start: number,
  profile: DatasetProfile,
  request: QuestionRequest,
): void {
  const content = contentAt(tokens, start);
  if (token === "top" && content && /^\d+$/.test(content.word)) return;
  const noun = readNoun(tokens, start, profile);
  if (noun.kind === "column" && noun.column.type === "number") {
    request.metrics.push({ column: noun.column.name });
    return;
  }
  if (noun.kind === "column") {
    request.dimensions.push(noun.column.name);
    return;
  }
  if (noun.kind === "missing") {
    rememberUnsupported(request, token === "top" ? "dimension" : "metric", noun.concept);
  }
}

function readNoun(tokens: string[], start: number, profile: DatasetProfile): Noun {
  const content = contentAt(tokens, start);
  if (!content) return { kind: "skip" };
  const { word, index } = content;
  if (/^(?:19|20)\d{2}$/.test(word) || /^\d+(?:\.\d+)?$/.test(word)) return { kind: "year" };

  const next = tokens[index + 1];
  const phrase = next ? matchPhrase(`${word} ${next}`, profile) : undefined;
  if (phrase) return { kind: "column", column: phrase };

  const column = matchColumn(word, profile);
  if (column) return { kind: "column", column };

  if (SKIP.has(word) || GENERIC.has(word) || GENERIC.has(singular(word)) || AGGREGATIONS[word] || GRAINS[word]) {
    return { kind: "skip" };
  }

  if (next === "date" || next === "dates") {
    return { kind: "missing", concept: `${word} date` };
  }

  const sample = findSample(word, profile);
  if (sample) return { kind: "value", column: sample.column, value: sample.value };

  const following = next ? matchColumn(next, profile) : undefined;
  if (following && following.type !== "number" && following.type !== "date") {
    return { kind: "value", column: following.name, value: word };
  }

  return { kind: "missing", concept: word };
}

function unmetRequest(request: QuestionRequest, plan: AnalysisPlan, profile: DatasetProfile): string | undefined {
  for (const metric of request.metrics) {
    const found = plan.metrics.find((item) => item.column === metric.column);
    const selected = plan.operation === "detail" && plan.select.includes(metric.column);
    if (metric.agg) {
      const counts =
        metric.agg === "count" &&
        plan.metrics.some((item) => item.agg === "count" && (!item.column || item.column === metric.column));
      if (!counts && (!found || found.agg !== metric.agg)) {
        return `The analysis plan does not use the requested ${metric.agg} of '${metric.column}'.`;
      }
    } else if (!found && !selected) {
      return `The analysis plan does not use the requested column '${metric.column}'.`;
    }
  }

  for (const column of unique(request.dimensions)) {
    if (plan.operation === "detail") {
      if (!plan.select.includes(column) && !plan.filters.some((filter) => filter.column === column)) {
        return `The analysis plan does not use the requested column '${column}'.`;
      }
    } else if (!plan.groupBy.includes(column)) {
      return `The analysis plan does not group by the requested column '${column}'.`;
    }
  }

  for (const column of unique(request.filterColumns)) {
    if (!plan.filters.some((filter) => filter.column === column)) {
      return `The analysis plan does not filter on '${column}'.`;
    }
  }

  for (const expected of request.values) {
    if (!plan.filters.some((filter) => filterMatchesValue(filter, expected))) {
      return `The analysis plan does not filter to '${expected.value}'.`;
    }
  }

  if (request.grain && (plan.operation !== "trend" || plan.grain !== request.grain)) {
    return `The analysis plan does not use the requested ${request.grain} trend.`;
  }

  for (const year of unique(request.years)) {
    if (!coversYear(plan.filters, year, profile)) {
      return `The analysis plan does not filter to ${year}.`;
    }
  }

  for (const comparison of unique(request.comparisons)) {
    if (!plan.filters.some((filter) => filterHasNumber(filter, comparison))) {
      return "The analysis plan does not apply the requested comparison.";
    }
  }

  if (request.countRows && !plan.metrics.some((metric) => metric.agg === "count")) {
    return "The analysis plan does not count rows.";
  }

  for (const column of unique(request.mentions)) {
    if (!planUses(plan, column)) {
      return `The analysis plan does not use the requested column '${column}'.`;
    }
  }

  return undefined;
}

function rememberUnsupported(request: QuestionRequest, role: RequestedRole, concept: string): void {
  request.unsupported ??= { role, concept };
}

function unsupported(role: RequestedRole, concept: string): AnalysisFailure {
  return new AnalysisFailure({
    stage: "validate-plan",
    message: `The requested ${role} '${concept}' is not available in this dataset.`,
    details: { code: "unsupported_request", role, concept },
  });
}

function planUses(plan: AnalysisPlan, column: string): boolean {
  return (
    plan.groupBy.includes(column) ||
    plan.select.includes(column) ||
    plan.timeColumn === column ||
    plan.metrics.some((metric) => metric.column === column) ||
    plan.filters.some((filter) => filter.column === column)
  );
}

function filterMatchesValue(filter: Filter, expected: RequestedValue): boolean {
  if (expected.column && filter.column !== expected.column) return false;
  const values = Array.isArray(filter.value) ? filter.value : [filter.value];
  return values.some((value) => String(value).toLowerCase() === expected.value.toLowerCase());
}

function coversYear(filters: Filter[], year: string, profile: DatasetProfile): boolean {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const nextYear = `${Number(year) + 1}-01-01`;
  const dated = filters.filter((filter) => profile.columns.find((column) => column.name === filter.column)?.type === "date");

  const between = dated.some(
    (filter) =>
      filter.op === "between" &&
      Array.isArray(filter.value) &&
      String(filter.value[0]) === start &&
      String(filter.value[1]) === end,
  );
  if (between) return true;

  const hasStart = dated.some((filter) => filter.op === "gte" && String(filter.value) === start);
  const hasEnd = dated.some(
    (filter) =>
      (filter.op === "lte" && String(filter.value) === end) || (filter.op === "lt" && String(filter.value) === nextYear),
  );
  return hasStart && hasEnd;
}

function filterHasNumber(filter: Filter, raw: string): boolean {
  const values = Array.isArray(filter.value) ? filter.value : [filter.value];
  return values.some((value) => String(value) === raw);
}

function mentionsColumn(tokens: string[], column: ColumnProfile): boolean {
  if (column.name.length < 2) return false;
  const parts = column.name.toLowerCase().split("_");
  for (let index = 0; index <= tokens.length - parts.length; index += 1) {
    const matches = parts.every((part, offset) => {
      const token = tokens[index + offset];
      return token === part || singular(token ?? "") === singular(part);
    });
    if (matches) return true;
  }
  return false;
}

function matchPhrase(phrase: string, profile: DatasetProfile): ColumnProfile | undefined {
  const normalized = phrase.toLowerCase();
  const words = normalized.split(" ");
  const singularPhrase = words.map((word, index) => (index === words.length - 1 ? singular(word) : word)).join(" ");
  return profile.columns.find((column) => {
    const spaced = column.name.toLowerCase().replace(/_/g, " ");
    return spaced === normalized || spaced === singularPhrase;
  });
}

function matchColumn(word: string, profile: DatasetProfile): ColumnProfile | undefined {
  return profile.columns.find((column) => {
    const name = column.name.toLowerCase();
    return !name.includes("_") && (name === word || singular(name) === singular(word));
  });
}

function findSample(word: string, profile: DatasetProfile): { column: string; value: string } | undefined {
  if (word.length < 2) return undefined;
  const target = word.toLowerCase();
  for (const column of profile.columns) {
    if (column.type !== "string" && column.type !== "boolean") continue;
    const sample = column.sampleValues.find((value) => value.toLowerCase() === target);
    if (sample) return { column: column.name, value: sample };
  }
  return undefined;
}

function contentAt(tokens: string[], start: number): { word: string; index: number } | undefined {
  for (let index = start; index < tokens.length; index += 1) {
    const word = tokens[index];
    if (!word || ARTICLES.has(word) || word === "of" || word === "me") continue;
    return { word, index };
  }
  return undefined;
}

function requestedGrain(text: string): NonNullable<AnalysisPlan["grain"]> | undefined {
  const patterned = text.match(/\b(?:each|per|every|by)\s+(months?|quarters?|years?)\b/);
  if (patterned?.[1] && GRAINS[patterned[1]]) return GRAINS[patterned[1]];
  const word = text.match(/\b(monthly|quarterly|yearly)\b/);
  if (word?.[1] && GRAINS[word[1]]) return GRAINS[word[1]];
  return undefined;
}

function singular(word: string): string {
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ses") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) return word.slice(0, -1);
  return word;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
