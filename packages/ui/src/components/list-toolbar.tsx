"use client";

import { LIST_PARAMS } from "@fleetapp/core";
import { parseAsString, useQueryStates } from "nuqs";
import type * as React from "react";

import { AutoSubmitSelect } from "./auto-submit-select";
import { Button } from "./button";
import { Input } from "./input";

export interface ListToolbarFilter {
  key: string;
  label: string;
  options: readonly { value: string; label: string }[];
}

/**
 * A list's search box and filters, kept in the page address by nuqs: a new
 * search or filter updates the address and the server redraws the list,
 * without a full page reload. A new search starts from the first page and
 * keeps the sort. Search applies on Enter or the button; a filter applies
 * when chosen (by keyboard, on Enter or on leaving it).
 */
export function ListToolbar(props: {
  searchLabel: string;
  search: string;
  filters: readonly ListToolbarFilter[];
  filterValues: Readonly<Record<string, string | undefined>>;
}): React.JSX.Element {
  const parsers = Object.fromEntries(
    [LIST_PARAMS.search, LIST_PARAMS.page, ...props.filters.map((filter) => filter.key)].map(
      (name) => [name, parseAsString],
    ),
  );
  // shallow: false asks the server for the new page of rows.
  const [, setParams] = useQueryStates(parsers, { shallow: false, history: "push" });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const textOf = (name: string): string | null => {
      const value = formData.get(name);
      return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
    };
    void setParams({
      [LIST_PARAMS.search]: textOf(LIST_PARAMS.search),
      [LIST_PARAMS.page]: null,
      ...Object.fromEntries(props.filters.map((filter) => [filter.key, textOf(filter.key)])),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="flex flex-1 flex-col gap-2 text-sm font-medium">
        {props.searchLabel}
        <Input type="search" name={LIST_PARAMS.search} defaultValue={props.search} />
      </label>
      {props.filters.map((filter) => (
        <label key={filter.key} className="flex flex-col gap-2 text-sm font-medium sm:w-48">
          {filter.label}
          <AutoSubmitSelect name={filter.key} defaultValue={props.filterValues[filter.key] ?? ""}>
            <option value="">All</option>
            {filter.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </AutoSubmitSelect>
        </label>
      ))}
      <Button type="submit" variant="outline">
        Search
      </Button>
    </form>
  );
}
