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

/**
 * Screens in the apps are built from the shared pieces in packages/ui, so a
 * change to one (its look, its size, its accessibility) reaches every screen.
 * Only packages/ui itself may use the raw elements.
 */
export const appStandards = [
  {
    files: ["src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name=/^(button|select|textarea|table|label)$/]",
          message:
            "Use the shared component from @fleetapp/ui (Button, Select, FormField, Checkbox, the shared list) instead of a raw element.",
        },
        {
          selector:
            "JSXOpeningElement[name.name='input']:not(:has(JSXAttribute[name.name='type'][value.value='hidden']))",
          message:
            "Use Input, FormattedInput, Checkbox or CodeInput from @fleetapp/ui. Only hidden inputs may be raw.",
        },
      ],
    },
  },
];
