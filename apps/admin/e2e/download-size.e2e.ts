import { describeDownloadBudgets } from "@fleetapp/e2e/download-size";

/** Each page's JavaScript budget, compressed: what it downloads today (1 Nov 2026) plus about 10%. */
describeDownloadBudgets({
  "/": 180,
  // Raised from 440 (1 Nov 2026): the catalogue now shows the bookings calendar (FullCalendar).
  "/components": 595,
  "/operators": 180,
  "/operators/new": 330,
  "/car-models": 330,
});
