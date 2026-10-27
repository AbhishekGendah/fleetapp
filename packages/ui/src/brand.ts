/**
 * The brand: the one place the product's name and colours are written down
 * (CLAUDE.md). Renaming the product, or changing its colour, is an edit to
 * this file and to the matching tokens in styles/theme.css, which a test
 * keeps in step.
 *
 * Emails need the colours as plain hex values, because email clients ignore
 * stylesheets; the apps take them from theme.css.
 */
export const BRAND = {
  productName: "PintoFleet",
  adminName: "PintoFleet Admin",
  /** The placeholder logo's mark: the first letter, until there is a real logo. */
  logoMark: "P",
  colours: {
    primary: "#0F766E",
    primaryDark: "#115E59",
    primarySoft: "#E6F4F1",
    attention: "#B45309",
    attentionSoft: "#FEF3C7",
    danger: "#DC2626",
    text: "#0F172A",
    mutedText: "#64748B",
    border: "#E2E8F0",
    page: "#F8FAFC",
  },
} as const;
