import { z } from "zod";

const AuthEnvSchema = z.object({
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
});

const CI_FALLBACK = {
  BETTER_AUTH_SECRET: "ci_dummy_better_auth_secret_32_chars!!",
  BETTER_AUTH_URL: "http://localhost:3000",
} as const;

export function loadAuthEnv() {
  const result = AuthEnvSchema.safeParse({
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  });

  if (result.success) {
    return result.data;
  }

  const allowFallback =
    process.env.NEXT_PHASE === "phase-production-build" ||
    process.env.CI === "true" ||
    process.env.CI === "1";

  if (allowFallback) {
    return CI_FALLBACK;
  }

  throw new Error(
    `Invalid auth environment: ${result.error.issues.map((i) => i.message).join(", ")}`
  );
}

export const authEnv = loadAuthEnv();
