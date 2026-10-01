import { z } from "zod";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

const geminiEnvSchema = z.object({
  GEMINI_API_KEY: z.string().trim().min(1).optional(),
  GEMINI_MODEL: z.string().trim().min(1).optional(),
});

export type GeminiEnv = {
  apiKey: string | undefined;
  model: string;
};

function blankToUndefined(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  return value;
}

export function readGeminiEnv(env: NodeJS.ProcessEnv = process.env): GeminiEnv {
  const parsed = geminiEnvSchema.safeParse({
    GEMINI_API_KEY: blankToUndefined(env.GEMINI_API_KEY),
    GEMINI_MODEL: blankToUndefined(env.GEMINI_MODEL),
  });

  if (!parsed.success) {
    throw new Error("GEMINI_MODEL must be a non-empty string when it is set.");
  }

  return {
    apiKey: parsed.data.GEMINI_API_KEY,
    model: parsed.data.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
  };
}
