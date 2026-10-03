import { DEFAULT_LIMITS } from "@/lib/analysis/limits";

const MAX_NAME_LENGTH = 180;

export type UploadRejection = {
  code: "invalid_file" | "empty_file" | "upload_limit";
  message: string;
};

export function rejectUpload(file: { name: string; size: number }): UploadRejection | null {
  if (!csvFileName(file.name)) {
    return { code: "invalid_file", message: "Upload a CSV file." };
  }
  if (file.size <= 0) {
    return { code: "empty_file", message: "The CSV file is empty." };
  }
  if (file.size > DEFAULT_LIMITS.maxUploadBytes) {
    return {
      code: "upload_limit",
      message: `This file is larger than the ${formatMegabytes(DEFAULT_LIMITS.maxUploadBytes)} limit.`,
    };
  }
  return null;
}

export function csvFileName(name: string): string | null {
  const base = name.split(/[/\\]/).pop()?.trim() ?? "";
  if (!base || base.length > MAX_NAME_LENGTH || base.includes("\0")) {
    return null;
  }
  if (!base.toLowerCase().endsWith(".csv")) {
    return null;
  }
  return base;
}

export function formatMegabytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  const label = Number.isInteger(megabytes) ? String(megabytes) : megabytes.toFixed(1);
  return `${label} MB`;
}
