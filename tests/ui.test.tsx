/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { AnalysisResponse, DatasetProfile } from "@/lib/analysis/types";
import { AnswerView } from "@/components/answer-view";
import { ErrorNotice } from "@/components/error-notice";
import { Workspace } from "@/components/workspace";

afterEach(() => {
  cleanup();
});

const profile: DatasetProfile = {
  datasetId: "11111111-1111-4111-8111-111111111111",
  fileName: "sales.csv",
  rowCount: 22,
  columns: [
    {
      name: "product",
      type: "string",
      nullable: false,
      nullCount: 0,
      distinctCount: 5,
      sampleValues: ["Widget"],
    },
    {
      name: "revenue",
      type: "number",
      nullable: false,
      nullCount: 0,
      distinctCount: 10,
      sampleValues: ["100"],
      min: 10,
      max: 500,
    },
    {
      name: "order_date",
      type: "date",
      nullable: false,
      nullCount: 0,
      distinctCount: 12,
      sampleValues: ["2025-01-20"],
    },
  ],
  warnings: ["Column 'entered_on' uses ambiguous day/month dates and was marked unknown."],
};

const revenueResponse: AnalysisResponse = {
  answer: "Sensor generated the highest revenue at 500.\n* Gadget: 340",
  warnings: ["Column 'legacy_code' has mixed value types and was marked unknown."],
  chart: { type: "bar", x: "product", y: "sum_revenue" },
  evidence: {
    datasetId: profile.datasetId,
    question: "Which products generated the most revenue in 2025?",
    engine: "pandas",
    plan: {
      operation: "aggregate",
      filters: [{ column: "order_date", op: "between", value: ["2025-01-01", "2025-12-31"] }],
      groupBy: ["product"],
      metrics: [{ column: "revenue", agg: "sum" }],
      select: [],
      sortBy: "sum_revenue",
      sortDirection: "desc",
      limit: 10,
      rationale: "Sum revenue by product for orders placed in 2025.",
    },
    result: {
      columns: [
        { name: "product", type: "string" },
        { name: "sum_revenue", type: "number" },
      ],
      rows: [
        { product: "Sensor", sum_revenue: 500 },
        { product: "Gadget", sum_revenue: 340 },
      ],
      rowCount: 2,
      truncated: false,
    },
  },
};

describe("product UI", () => {
  it("shows the upload state and rejects a file that is not a CSV", () => {
    render(<Workspace uploadFile={async () => profile} />);

    expect(screen.getByRole("heading", { name: "Ask questions about your business data." })).toBeTruthy();
    expect(screen.getByText("Upload your CSV")).toBeTruthy();
    expect(screen.getByText(/Supported: CSV/)).toBeTruthy();

    const input = document.querySelector("input[type='file']");
    if (!(input instanceof HTMLInputElement)) throw new Error("Missing file input.");
    const label = input.closest("label");
    if (!label) throw new Error("Missing upload target.");
    fireEvent.drop(label, {
      dataTransfer: { files: [new File(["notes"], "notes.txt", { type: "text/plain" })] },
    });

    expect(screen.getByRole("alert").textContent).toContain("Upload a CSV file.");
    expect(screen.queryByRole("heading", { name: "sales.csv" })).toBeNull();
  });

  it("shows the dataset summary after a CSV upload", async () => {
    const user = userEvent.setup();
    render(<Workspace uploadFile={async () => profile} />);
    const input = document.querySelector("input[type='file']");
    if (!(input instanceof HTMLInputElement)) throw new Error("Missing file input.");
    await user.upload(input, new File(["product,revenue"], "sales.csv", { type: "text/csv" }));

    expect(await screen.findByRole("heading", { name: "sales.csv" })).toBeTruthy();
    expect(screen.getByText("22 rows · 3 columns")).toBeTruthy();
    expect(screen.getByText("Product")).toBeTruthy();
    expect(screen.getByText("Number")).toBeTruthy();
    expect(screen.getByText("Date")).toBeTruthy();
    expect(screen.getByText(/Entered On has ambiguous dates/)).toBeTruthy();
  });

  it("submits a question, shows loading, then the answer, chart, and evidence", async () => {
    const user = userEvent.setup();
    let finish: (response: AnalysisResponse) => void = () => undefined;
    const pending = new Promise<AnalysisResponse>((resolve) => {
      finish = resolve;
    });
    render(
      <Workspace
        uploadFile={async () => profile}
        askQuestion={() => pending}
      />,
    );
    const input = document.querySelector("input[type='file']");
    if (!(input instanceof HTMLInputElement)) throw new Error("Missing file input.");
    await user.upload(input, new File(["product,revenue"], "sales.csv", { type: "text/csv" }));
    await screen.findByRole("heading", { name: "sales.csv" });

    await user.click(screen.getByRole("button", { name: "Which products generated the most revenue in 2025?" }));
    expect((screen.getByLabelText("Ask anything about your data") as HTMLTextAreaElement).value).toContain("2025");
    await user.click(screen.getByRole("button", { name: "Analyze" }));

    expect(screen.getByRole("status").textContent).toContain("Analyzing your data");
    finish(revenueResponse);

    expect(await screen.findByRole("heading", { name: /Sensor generated the highest revenue/ })).toBeTruthy();
    expect(screen.getByText("Gadget: 340")).toBeTruthy();
    expect(screen.queryByText("* Gadget: 340")).toBeNull();
    expect(screen.getByRole("img", { name: "Bar chart of Revenue by Product" })).toBeTruthy();
    expect(screen.getAllByText(/£500/).length).toBeGreaterThan(0);
    expect(screen.getByText("Analysis performed")).toBeTruthy();
    expect(screen.getAllByText("Aggregate").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Order Date → 2025").length).toBeGreaterThan(0);
    expect(screen.getAllByText("SUM(Revenue)").length).toBeGreaterThan(0);
    expect(screen.getByText("How InsightFlow analysed this")).toBeTruthy();
    expect(screen.getByText("Revenue ↓")).toBeTruthy();
    expect(screen.getByText(/mixed value types/)).toBeTruthy();
  });

  it("renders an analysis error without internal details", () => {
    render(
      <ErrorNotice
        error={{
          title: "We couldn't analyse that question.",
          message: 'The requested column "profit" isn\'t present in this dataset.',
        }}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("profit");
    expect(alert.textContent).not.toContain("/Users/");
  });

  it("renders an empty result without a chart", () => {
    render(
      <AnswerView
        response={{
          ...revenueResponse,
          answer: "No matching records were found.",
          chart: { type: "table" },
          evidence: {
            ...revenueResponse.evidence,
            result: { columns: [], rows: [], rowCount: 0, truncated: false },
          },
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "No matching records found." })).toBeTruthy();
    expect(screen.getByText("Try changing the question or filters.")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
