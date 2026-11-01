import { describe, expect, it } from "vitest";

import { contentDisposition } from "./content-disposition";

describe("contentDisposition", () => {
  it("keeps a plain name as it is", () => {
    expect(contentDisposition("attachment", "cars.csv")).toBe(
      `attachment; filename="cars.csv"; filename*=UTF-8''cars.csv`,
    );
  });

  it("never lets quotes, accents or line breaks break the header", () => {
    const header = contentDisposition("inline", 'Sam "O\'Brien" Škoda\n.pdf');

    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toBe(
      `inline; filename="Sam _O'Brien_ _koda_.pdf"; filename*=UTF-8''Sam%20%22O%27Brien%22%20%C5%A0koda%0A.pdf`,
    );
  });
});
