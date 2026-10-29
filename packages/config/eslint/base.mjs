import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

import { standards } from "./standards.mjs";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  ...standards,
  { ignores: ["dist/**", "node_modules/**", ".turbo/**"] },
);
