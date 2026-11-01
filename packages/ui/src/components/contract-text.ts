import StarterKit from "@tiptap/starter-kit";

import { cn } from "../lib/utils";

export const CONTRACT_HEADING_LEVELS = [1, 2, 3] as const;

/**
 * What contract text may hold: headings, paragraphs, lists, a dividing line,
 * bold, italic and underline. The editor and the reader share this, so the
 * Renter reads exactly what the Operator wrote.
 */
export const contractTextKit = StarterKit.configure({
  blockquote: false,
  code: false,
  codeBlock: false,
  strike: false,
  link: false,
  heading: { levels: [...CONTRACT_HEADING_LEVELS] },
});

/** How contract text looks, in the editor and when read. */
export const CONTRACT_TEXT_CLASSES = cn(
  "text-base",
  "[&_h1]:text-primary [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-bold",
  "[&_h2]:text-primary [&_h2]:mt-4 [&_h2]:mb-1 [&_h2]:text-lg [&_h2]:font-bold",
  "[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-semibold",
  "[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6",
  "[&_hr]:my-4 [&_hr]:border-t",
);
