import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as uploadPost } from "@/app/api/datasets/route";
import { handleAskRequest } from "@/app/api/datasets/[id]/ask/route";
import { MockLLMProvider, REVENUE_QUESTION, UNKNOWN_COLUMN_QUESTION } from "@/lib/ai/mock";
import { DEFAULT_LIMITS } from "@/lib/analysis/limits";
import { askDataset } from "@/lib/datasets/ask";
import { uploadDataset } from "@/lib/datasets/upload";
import { salesCsv } from "./helpers";

let root = "";
let previousUploadDir: string | undefined;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "insightflow-api-"));
  previousUploadDir = process.env.DATA_UPLOAD_DIR;
  process.env.DATA_UPLOAD_DIR = root;
});

afterAll(async () => {
  if (previousUploadDir === undefined) {
    delete process.env.DATA_UPLOAD_DIR;
  } else {
    process.env.DATA_UPLOAD_DIR = previousUploadDir;
  }
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dataset upload", () => {
  it("accepts a CSV and returns the profile without the dataset rows", async () => {
    const bytes = await readFile(salesCsv);
    const response = await uploadPost(uploadRequest(bytes, "sales.csv"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      fileName: "sales.csv",
      rowCount: 22,
    });
    expect(body.columns.map((column: { name: string }) => column.name)).toContain("revenue");
    expect(body.warnings.length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty("rows");
  });

  it("rejects a file that is not a CSV", async () => {
    const response = await uploadPost(uploadRequest(Buffer.from("hello"), "notes.txt"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toBe("Upload a CSV file.");
    expect(JSON.stringify(body)).not.toContain("/Users/");
  });

  it("rejects an oversized file", async () => {
    const failure = await uploadDataset({
      fileName: "big.csv",
      bytes: new Uint8Array(DEFAULT_LIMITS.maxUploadBytes + 1),
      root,
    }).catch((error: unknown) => error);

    const { toPublicError } = await import("@/lib/api/public-error");
    const mapped = toPublicError(failure);
    expect(mapped.status).toBe(413);
    expect(mapped.body.error.title).toBe("This file is too large.");
  });
});

describe("dataset ask", () => {
  it("returns an AnalysisResponse for a valid question", async () => {
    const profile = await uploadDataset({
      fileName: "sales.csv",
      bytes: await readFile(salesCsv),
      root,
    });

    const response = await askDataset({
      datasetId: profile.datasetId,
      question: REVENUE_QUESTION,
      llm: new MockLLMProvider(),
      root,
    });

    expect(response.evidence.engine).toBe("pandas");
    expect(response.evidence.result.rows[0]).toEqual({ product: "Sensor", sum_revenue: 500 });
    expect(response.chart).toEqual({ type: "bar", x: "product", y: "sum_revenue" });
  });

  it("returns a safe error for an unknown dataset id", async () => {
    const response = await handleAskRequest(askRequest("What is revenue?"), "not-a-dataset", new MockLLMProvider());
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.message).toBe("Upload the CSV again to continue.");
    expect(JSON.stringify(body)).not.toContain(root);
  });

  it("turns an analysis failure into a safe API response", async () => {
    const profile = await uploadDataset({
      fileName: "sales.csv",
      bytes: await readFile(salesCsv),
      root,
    });
    const response = await handleAskRequest(
      askRequest(UNKNOWN_COLUMN_QUESTION),
      profile.datasetId,
      new MockLLMProvider(),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toEqual({
      title: "We couldn't analyse that question.",
      message: 'The requested column "profit" isn\'t present in this dataset.',
      stage: "validate-plan",
    });
    expect(JSON.stringify(body)).not.toMatch(/\/Users\/|Traceback|python\//);
  });

  it("rejects a substituted metric with a safe validation error", async () => {
    const profile = await uploadDataset({
      fileName: "sales.csv",
      bytes: await readFile(salesCsv),
      root,
    });
    const response = await handleAskRequest(
      askRequest(UNKNOWN_COLUMN_QUESTION),
      profile.datasetId,
      new MockLLMProvider({
        plans: {
          [UNKNOWN_COLUMN_QUESTION]: {
            operation: "aggregate",
            filters: [],
            groupBy: ["product"],
            metrics: [{ column: "revenue", agg: "sum" }],
            select: [],
            limit: 10,
            rationale: "Sum revenue by product.",
          },
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toEqual({
      title: "We couldn't analyse that question.",
      message: "The requested metric 'profit' is not available in this dataset.",
      stage: "validate-plan",
    });
    expect(JSON.stringify(body)).not.toMatch(/sum_revenue|Sensor|Traceback|\/Users\/|GEMINI/);
  });
});

function uploadRequest(bytes: Uint8Array, name: string): Request {
  const form = new FormData();
  form.set("file", new File([new TextDecoder().decode(bytes)], name, { type: "text/csv" }));
  return new Request("http://localhost/api/datasets", { method: "POST", body: form });
}

function askRequest(question: string): Request {
  return new Request("http://localhost/api/datasets/demo/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }),
  });
}
