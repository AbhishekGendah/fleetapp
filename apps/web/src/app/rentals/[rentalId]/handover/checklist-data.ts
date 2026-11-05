import type { HandoverGap } from "@fleetapp/core";

import type { HandoverDetailField } from "../../../../lib/handover/handover-input";

/** A photo the server has, and where to show its small copy. */
export interface SavedPhoto {
  fileId: string;
  viewUrl: string;
}

export interface SavedMark {
  id: string;
  x: number;
  y: number;
  description: string;
  photo: SavedPhoto | null;
}

/** Everything the checklist screen shows, as the server has it now. */
export interface ChecklistData {
  rentalId: string;
  inspectionId: string;
  carLabel: string;
  renterName: string;
  photoNames: string[];
  photos: Record<string, SavedPhoto>;
  marks: SavedMark[];
  details: Record<HandoverDetailField, string>;
  gaps: HandoverGap[];
  /** Why the Renter cannot accept yet beyond the checklist: contract, licence, car. */
  blockers: string[];
}
