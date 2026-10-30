import type { InMemoryListRules } from "@fleetapp/core";
import { Badge } from "@fleetapp/ui/badge";
import type { DataListDefinition } from "@fleetapp/ui/data-list";

import type { CatalogueEntrySummary, MakeSummary } from "../../lib/car-models/car-model-queries";

export const SHOW_FILTER_KEY = "show";
const HIDDEN_FILTER_VALUE = "hidden";

const nicknamesColumn = {
  key: "aliases",
  label: "Also known as",
  exportValue: (entry: CatalogueEntrySummary) => entry.aliases.join(", "),
};

const statusColumn = {
  key: "status",
  label: "Status",
  exportValue: (entry: CatalogueEntrySummary) => (entry.hiddenAt ? "Hidden" : "Shown"),
  render: (entry: CatalogueEntrySummary) =>
    entry.hiddenAt ? <Badge>Hidden</Badge> : <Badge tone="good">Shown</Badge>,
};

const showFilter = {
  key: SHOW_FILTER_KEY,
  label: "Show",
  options: [{ value: HIDDEN_FILTER_VALUE, label: "Hidden only" }],
};

/** Searched and filtered in memory: the whole list is a few hundred short rows. */
function entryRules<Entry extends CatalogueEntrySummary>(): InMemoryListRules<Entry> {
  return {
    searchText: (entry) => [entry.name, ...entry.aliases].join(" "),
    sortValues: { name: (entry) => entry.name },
    filterMatches: { [SHOW_FILTER_KEY]: (entry) => entry.hiddenAt !== null },
  };
}

export const MAKE_LIST: DataListDefinition<MakeSummary> = {
  columns: [
    {
      key: "name",
      label: "Make",
      isCardTitle: true,
      isSortable: true,
      exportValue: (make) => make.name,
    },
    nicknamesColumn,
    { key: "models", label: "Models", exportValue: (make) => make.modelCount },
    statusColumn,
  ],
  filters: [showFilter],
  defaultSort: { column: "name", direction: "asc" },
};
export const MAKE_LIST_RULES = entryRules<MakeSummary>();

export const MODEL_LIST: DataListDefinition<CatalogueEntrySummary> = {
  columns: [
    {
      key: "name",
      label: "Model",
      isCardTitle: true,
      isSortable: true,
      exportValue: (model) => model.name,
    },
    nicknamesColumn,
    statusColumn,
  ],
  filters: [showFilter],
  defaultSort: { column: "name", direction: "asc" },
};
export const MODEL_LIST_RULES = entryRules<CatalogueEntrySummary>();
