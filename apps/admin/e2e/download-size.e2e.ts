import { describeDownloadBudgets } from "@fleetapp/e2e/download-size";

/** Each page's JavaScript budget, compressed: what it downloads today (1 Nov 2026) plus about 10%. */
describeDownloadBudgets({
  "/": 180,
  // Raised on purpose (1 Nov 2026): the catalogue shows every piece, now including the
  // bookings calendar (FullCalendar; 440 to 595) and the contract editor (TipTap; to 760).
  "/components": 760,
  "/operators": 180,
  "/operators/new": 330,
  "/car-models": 330,
});
