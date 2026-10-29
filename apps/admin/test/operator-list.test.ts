import { missingListRules } from "@fleetapp/core";
import { describe, expect, it } from "vitest";

import { OPERATOR_LIST, OPERATOR_LIST_RULES } from "../src/app/operators/operator-list";

describe("the Operator list", () => {
  it("knows how to sort by every sortable column and apply every filter", () => {
    expect(
      missingListRules(OPERATOR_LIST, {
        sortKeys: Object.keys(OPERATOR_LIST_RULES.sortValues),
        filterKeys: Object.keys(OPERATOR_LIST_RULES.filterMatches),
      }),
    ).toEqual([]);
  });
});
