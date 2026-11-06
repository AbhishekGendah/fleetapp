import type { InMemoryListRules } from "@fleetapp/core";
import type { DataListDefinition } from "@fleetapp/ui/data-list";
import { ACTOR_TYPES, type ActorType } from "@fleetapp/db/schema";

import { formatAdminDateTime } from "../../../../lib/format";

/** One line of a business's Log, ready to show. */
export interface LogRow {
  id: string;
  occurredAt: Date;
  what: string;
  actorType: ActorType;
}

/** Who did it, as AGS would say it. */
export const ACTOR_LABELS: Readonly<Record<ActorType, string>> = {
  user: "The business",
  admin: "AGS",
  system: "The app",
  renter_link: "A Renter's link",
};

/** A business's Log as a paged, searchable list (Abhi's A6). */
export const LOG_LIST: DataListDefinition<LogRow> = {
  columns: [
    {
      key: "when",
      label: "When",
      isSortable: true,
      exportValue: (row) => row.occurredAt,
      render: (row) => formatAdminDateTime(row.occurredAt),
    },
    { key: "what", label: "What", isCardTitle: true, exportValue: (row) => row.what },
    { key: "by", label: "By", exportValue: (row) => ACTOR_LABELS[row.actorType] },
  ],
  filters: [
    {
      key: "by",
      label: "By",
      options: ACTOR_TYPES.map((actorType) => ({
        value: actorType,
        label: ACTOR_LABELS[actorType],
      })),
    },
  ],
  defaultSort: { column: "when", direction: "desc" },
};

/** Searched and paged in memory: the page holds the business's latest lines only. */
export const LOG_LIST_RULES: InMemoryListRules<LogRow> = {
  searchText: (row) => row.what,
  sortValues: { when: (row) => row.occurredAt },
  filterMatches: { by: (row, actorType) => row.actorType === actorType },
};
