import { describeDownloadBudgets } from "@fleetapp/e2e/download-size";

/** Each page's JavaScript budget, compressed: what it downloads today (1 Nov 2026) plus about 10%. */
describeDownloadBudgets({
  "/": 180,
  "/components": 440,
  "/operators": 180,
  "/operators/new": 330,
  "/car-models": 330,
});
