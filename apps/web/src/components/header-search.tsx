"use client";

import { QuickSearch } from "@fleetapp/ui/quick-search";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { searchHeaderAction } from "../app/header-search-action";
import {
  HEADER_SEARCH_MAXIMUM_LENGTH,
  HEADER_SEARCH_MINIMUM_LENGTH,
} from "../lib/search/header-search-limits";

/**
 * The top bar's search: cars, Renters and rentals as you type, each opening
 * its page. It starts afresh on each page, so the phone's sheet never stays
 * open over the page a result opened.
 */
export function HeaderSearch(): React.JSX.Element {
  const pathname = usePathname();
  return (
    <QuickSearch
      key={pathname}
      label="Search"
      placeholder="Search cars, Renters, rentals"
      search={searchHeaderAction}
      minimumLength={HEADER_SEARCH_MINIMUM_LENGTH}
      maximumLength={HEADER_SEARCH_MAXIMUM_LENGTH}
      linkComponent={Link}
    />
  );
}
