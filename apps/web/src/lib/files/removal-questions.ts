import type { ActionConfirm } from "@fleetapp/ui/action-button";

/** What removing a car's photo means, asked first (review A7-3). */
export const REMOVE_PHOTO_QUESTION: ActionConfirm = {
  title: "Remove this photo?",
  description:
    "It is hidden at once. You can bring it back from the Photos tab for 30 days; after that it is deleted for good.",
  confirmLabel: "Yes, remove it",
};

/** What removing a car's document means, asked first. */
export const REMOVE_DOCUMENT_QUESTION: ActionConfirm = {
  title: "Remove this document?",
  description:
    "It is hidden at once. You can bring it back from the Documents tab for 30 days; after that it is deleted for good.",
  confirmLabel: "Yes, remove it",
};

/** Receipts and tax papers are kept 5 years once removed (batch 7 decision 4, review G8-7). */
export const REMOVE_PAPER_QUESTION: ActionConfirm = {
  title: "Remove this paper?",
  description:
    "It is hidden at once, and kept 5 years as tax records must be, then deleted. A car's papers can be brought back from its Documents tab meanwhile.",
  confirmLabel: "Yes, remove it",
};
