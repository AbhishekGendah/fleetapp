import { contentDisposition, FILE_CONTENT_TYPES } from "@fleetapp/core";

/**
 * A PDF to open in the browser. It holds a Renter's details, so it is never
 * kept by the browser or anything in between.
 */
export function pdfResponse(pdf: Uint8Array, fileName: string): Response {
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": FILE_CONTENT_TYPES.pdf,
      "Content-Disposition": contentDisposition("inline", fileName),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
