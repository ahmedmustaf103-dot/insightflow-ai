export type AnalysisLimits = {
  maxUploadBytes: number;
  maxRows: number;
  maxResultRows: number;
};

export const DEFAULT_LIMITS: AnalysisLimits = {
  maxUploadBytes: 5 * 1024 * 1024,
  maxRows: 50_000,
  maxResultRows: 100,
};

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

export function resolveLimits(overrides?: Partial<AnalysisLimits>): AnalysisLimits {
  return {
    maxUploadBytes:
      overrides?.maxUploadBytes ?? readPositiveInt("MAX_UPLOAD_BYTES", DEFAULT_LIMITS.maxUploadBytes),
    maxRows: overrides?.maxRows ?? readPositiveInt("MAX_ROWS", DEFAULT_LIMITS.maxRows),
    maxResultRows:
      overrides?.maxResultRows ?? readPositiveInt("MAX_RESULT_ROWS", DEFAULT_LIMITS.maxResultRows),
  };
}
