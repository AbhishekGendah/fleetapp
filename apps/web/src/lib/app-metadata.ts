/** What a phone shows when the Operator app is added to its home screen. */
export const APP_DESCRIPTION = "Vehicle rental management for Australian rental businesses.";

const ICON_FOLDER = "/app-icons";
export const APP_ICONS = [
  { src: `${ICON_FOLDER}/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
  { src: `${ICON_FOLDER}/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
  // Extra space around the emblem so Android can crop it to a circle or squircle.
  { src: `${ICON_FOLDER}/maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
] as const;
