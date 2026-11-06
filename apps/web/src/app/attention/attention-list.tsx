import type { InMemoryListRules } from "@fleetapp/core";
import type { DataListDefinition } from "@fleetapp/ui/data-list";

import {
  ATTENTION_KIND_LABELS,
  ATTENTION_KINDS,
  attentionSearchText,
  type AttentionItem,
} from "../../lib/dashboard/attention-items";
import { AttentionBadge, AttentionText } from "./attention-row";

/** The page address's name for the kind filter: /attention?kind=paperwork. */
export const KIND_FILTER_KEY = "kind";
/** Not a column: the list keeps the most urgent first, the order it is given in. */
const URGENCY_ORDER = "urgency";

/** The full Needs attention list: what, which kind, and how urgent. */
export const ATTENTION_LIST: DataListDefinition<AttentionItem> = {
  columns: [
    {
      key: "what",
      label: "What",
      isCardTitle: true,
      exportValue: (item) => item.who.text,
      render: (item) => <AttentionText item={item} />,
    },
    {
      key: "kind",
      label: "Kind",
      exportValue: (item) => ATTENTION_KIND_LABELS[item.kind],
    },
    {
      key: "status",
      label: "Status",
      exportValue: (item) => item.label,
      render: (item) => <AttentionBadge item={item} />,
    },
  ],
  filters: [
    {
      key: KIND_FILTER_KEY,
      label: "Kind",
      options: ATTENTION_KINDS.map((kind) => ({ value: kind, label: ATTENTION_KIND_LABELS[kind] })),
    },
  ],
  defaultSort: { column: URGENCY_ORDER, direction: "asc" },
};

export const ATTENTION_LIST_RULES: InMemoryListRules<AttentionItem> = {
  searchText: attentionSearchText,
  sortValues: {},
  filterMatches: { [KIND_FILTER_KEY]: (item, kind) => item.kind === kind },
};
