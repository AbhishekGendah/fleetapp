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
  /** Taken from the logo. Navy and teal carry text; cyan is decoration only. */
  colours: {
    primary: "#0D3747",
    primaryDark: "#0A2B38",
    primarySoft: "#E5F4F5",
    /** The logo's cyan, darkened just enough to be readable as text. */
    teal: "#167884",
    /** The logo's own cyan. Too light for text: bars, icons and accents only. */
    cyan: "#2FA7B4",
    attention: "#B45309",
    attentionSoft: "#FEF3C7",
    danger: "#DC2626",
    text: "#0F172A",
    mutedText: "#64748B",
    border: "#E2E8F0",
    page: "#F8FAFC",
  },
} as const;
