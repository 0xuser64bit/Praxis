import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output and self-contained packages with their own toolchains. The
    // SDK ships via tsup with its own tsconfig (and tsconfig excludes it too),
    // so the app lint should not reach into its compiled dist or tests.
    "**/dist/**",
    "coverage/**",
    "sdk/**",
  ]),
]);

export default eslintConfig;
