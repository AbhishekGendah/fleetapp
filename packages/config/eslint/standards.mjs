import tseslint from "typescript-eslint";

/**
 * The AGS coding standards (docs/coding-standards.md) that a linter can
 * check, so they hold on every push rather than only in review.
 */
export const standards = [
  {
    files: ["**/*.{ts,tsx,mjs}"],
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      // "No any; use unknown and narrow it."
      "@typescript-eslint/no-explicit-any": "error",
      // "Never swallow errors in empty catch blocks."
      "no-empty": ["error", { allowEmptyCatch: false }],
      // Logs go to the hosting provider: only deliberate warnings and errors,
      // and those through describeErrorForLog (rule 7).
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    // "Explicit return types on all exported functions." React components
    // (in .tsx files) are left to inference, which is the React convention.
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/explicit-module-boundary-types": "error",
    },
  },
  {
    // Command-line scripts talk to the person running them.
    files: ["**/scripts/**"],
    rules: { "no-console": "off" },
  },
  {
    // Tests build fakes freely and do not ship.
    files: ["**/test/**", "**/*.test.ts", "**/testing/**"],
    rules: { "@typescript-eslint/explicit-module-boundary-types": "off" },
  },
];
