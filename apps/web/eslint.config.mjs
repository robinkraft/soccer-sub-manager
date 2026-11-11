import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "node_modules/**",
    "*.tsbuildinfo",
    // CJS bin wrapper for `pnpm link` — keep require(); real CLI is cli/index.ts
    "cli/index.js",
  ]),
  {
    settings: {
      react: { version: "19" },
      next: {
        rootDir: "apps/web",
      },
    },
  },
  {
    files: ["app/**/*.{ts,tsx}", "**/*.{ts,tsx}"],
    rules: {
      // Add any custom rules here if needed
    },
  },
]);
