import { expect, type Page } from "@playwright/test";

const PDF_START = "%PDF-";

/** The link opens a PDF that is never kept in any cache (it can hold a Renter's details). */
export async function expectPdf(page: Page, href: string | null): Promise<void> {
  expect(href).toBeTruthy();
  const response = await page.request.get(href ?? "");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/pdf");
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect((await response.body()).subarray(0, PDF_START.length).toString()).toBe(PDF_START);
}
