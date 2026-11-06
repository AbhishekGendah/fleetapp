import { describeDownloadBudgets } from "@fleetapp/e2e/download-size";

/** Each page's JavaScript budget, compressed: what it downloads today (1 Nov 2026) plus about 10%. */
describeDownloadBudgets({
  // Raised on purpose (6 Nov 2026): the home page (A1) and the Operators list carry the
  // New Operator pop-up (A3; Base UI's Dialog, 195 and 199 KB, the form itself loads on open).
  "/": 220,
  // Raised on purpose (1 Nov 2026): the catalogue shows every piece, now including the
  // bookings calendar (FullCalendar; 440 to 595), the contract editor (TipTap; to 760) and,
  // 3 Nov 2026, the fleet timeline (DayPilot Lite; 803, to 880).
  "/components": 880,
  "/operators": 220,
  "/operators/new": 330,
  "/car-models": 330,
});
