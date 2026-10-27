import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BRAND } from "./brand";

const THEME_CSS = readFileSync(
  fileURLToPath(new URL("./styles/theme.css", import.meta.url)),
  "utf8",
).toLowerCase();

/** Which theme token each brand colour must equal. */
const TOKEN_FOR_COLOUR: Record<keyof typeof BRAND.colours, string> = {
  primary: "--color-primary",
  primaryDark: "--color-primary-dark",
  primarySoft: "--color-primary-soft",
  teal: "--color-teal",
  cyan: "--color-cyan",
  attention: "--color-attention",
  attentionSoft: "--color-attention-soft",
  danger: "--color-destructive",
  text: "--color-foreground",
  mutedText: "--color-muted-foreground",
  border: "--color-border",
  page: "--color-background",
};

describe("the brand", () => {
  it.each(Object.entries(TOKEN_FOR_COLOUR))(
    "keeps %s the same in brand.ts and theme.css",
    (colour, token) => {
      const hex = BRAND.colours[colour as keyof typeof BRAND.colours].toLowerCase();

      expect(THEME_CSS).toContain(`${token}: ${hex};`);
    },
  );
});
