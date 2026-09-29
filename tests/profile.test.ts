import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { profileDataset } from "@/lib/datasets/profile";
import { failureOf, salesCsv } from "./helpers";

describe("profiling", () => {
  it("profiles the sales fixture", async () => {
    const profile = await profileDataset({
      csvPath: salesCsv,
      datasetId: "sales-demo",
      fileName: "sales.csv",
    });

    expect(profile.datasetId).toBe("sales-demo");
    expect(profile.fileName).toBe("sales.csv");
    expect(profile.rowCount).toBe(22);
    expect(profile.columns.map((column) => column.name)).toEqual([
      "product",
      "revenue",
      "order_date",
      "quantity",
      "region",
      "entered_on",
      "legacy_code",
    ]);

    const types = Object.fromEntries(profile.columns.map((column) => [column.name, column.type]));
    expect(types).toEqual({
      product: "string",
      revenue: "number",
      order_date: "date",
      quantity: "number",
      region: "string",
      entered_on: "unknown",
      legacy_code: "unknown",
    });

    const quantity = profile.columns.find((column) => column.name === "quantity");
    const region = profile.columns.find((column) => column.name === "region");
    const revenue = profile.columns.find((column) => column.name === "revenue");
    const orderDate = profile.columns.find((column) => column.name === "order_date");
    const product = profile.columns.find((column) => column.name === "product");

    expect(quantity).toMatchObject({ nullable: true, nullCount: 1 });
    expect(region).toMatchObject({ nullable: true, nullCount: 1, distinctCount: 4 });
    expect(product).toMatchObject({
      nullable: false,
      nullCount: 0,
      distinctCount: 5,
      sampleValues: ["Widget", "Gadget", "Gizmo"],
    });
    expect(revenue).toMatchObject({ min: 10, max: 500, sampleValues: ["100", "150", "200"] });
    expect(orderDate).toMatchObject({ min: "2024-01-02", max: "2025-12-01" });
    expect(profile.warnings).toEqual([
      "Column 'entered_on' uses ambiguous day/month dates and was marked unknown.",
      "Column 'legacy_code' has mixed value types and was marked unknown.",
    ]);
  });

  it("infers boolean columns", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "insightflow-"));
    const csvPath = path.join(directory, "flags.csv");
    await writeFile(csvPath, "active\ntrue\nfalse\ntrue\n");

    const profile = await profileDataset({
      csvPath,
      datasetId: "flags",
      fileName: "flags.csv",
    });

    expect(profile.columns[0]).toMatchObject({
      name: "active",
      type: "boolean",
      nullable: false,
      nullCount: 0,
      distinctCount: 2,
      sampleValues: ["true", "false"],
    });
  });

  it("rejects a file over the upload limit", async () => {
    const failure = await failureOf(
      profileDataset({
        csvPath: salesCsv,
        datasetId: "sales-demo",
        fileName: "sales.csv",
        limits: { maxUploadBytes: 1 },
      }),
    );

    expect(failure.error.stage).toBe("profile");
    expect(failure.error.details).toMatchObject({ code: "upload_limit" });
  });

  it("rejects a CSV over the row limit", async () => {
    const failure = await failureOf(
      profileDataset({
        csvPath: salesCsv,
        datasetId: "sales-demo",
        fileName: "sales.csv",
        limits: { maxRows: 5 },
      }),
    );

    expect(failure.error.stage).toBe("profile");
    expect(failure.error.details).toMatchObject({ code: "row_limit", maxRows: 5 });
  });
});
