import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { datasetProfileSchema, type DatasetProfile } from "@/lib/analysis/types";

const DATASET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class DatasetNotFoundError extends Error {
  constructor() {
    super("Dataset not found.");
    this.name = "DatasetNotFoundError";
  }
}

export function uploadRoot(): string {
  const configured = process.env.DATA_UPLOAD_DIR?.trim();
  if (configured) return configured;
  return path.join(process.cwd(), "data", "uploads");
}

export function createDatasetId(): string {
  return randomUUID();
}

export async function writeDatasetFiles(input: {
  root?: string;
  datasetId: string;
  bytes: Uint8Array;
}): Promise<{ csvPath: string }> {
  const root = input.root ?? uploadRoot();
  const csvPath = datasetPath(root, input.datasetId, ".csv");
  await mkdir(path.dirname(csvPath), { recursive: true });
  await writeFile(csvPath, input.bytes);
  return { csvPath };
}

export async function writeDatasetProfile(input: {
  root?: string;
  datasetId: string;
  profile: DatasetProfile;
}): Promise<void> {
  const profilePath = datasetPath(input.root ?? uploadRoot(), input.datasetId, ".profile.json");
  await writeFile(profilePath, JSON.stringify(input.profile));
}

export async function removeDataset(root: string, datasetId: string): Promise<void> {
  await rm(datasetPath(root, datasetId, ".csv"), { force: true });
  await rm(datasetPath(root, datasetId, ".profile.json"), { force: true });
}

export async function loadDataset(
  datasetId: string,
  root = uploadRoot(),
): Promise<{ csvPath: string; profile: DatasetProfile }> {
  const csvPath = datasetPath(root, datasetId, ".csv");
  const profilePath = datasetPath(root, datasetId, ".profile.json");
  const raw = await readFile(profilePath, "utf8").catch(() => {
    throw new DatasetNotFoundError();
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DatasetNotFoundError();
  }

  const profile = datasetProfileSchema.safeParse(parsed);
  if (!profile.success || profile.data.datasetId !== datasetId) {
    throw new DatasetNotFoundError();
  }

  await readFile(csvPath).catch(() => {
    throw new DatasetNotFoundError();
  });

  return { csvPath, profile: profile.data };
}

function datasetPath(root: string, datasetId: string, suffix: ".csv" | ".profile.json"): string {
  if (!DATASET_ID.test(datasetId)) {
    throw new DatasetNotFoundError();
  }
  const dir = path.resolve(root);
  const file = path.resolve(dir, `${datasetId}${suffix}`);
  if (path.dirname(file) !== dir) {
    throw new DatasetNotFoundError();
  }
  return file;
}
