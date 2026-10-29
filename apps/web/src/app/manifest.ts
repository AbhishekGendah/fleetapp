import { BRAND } from "@fleetapp/ui/brand";
import type { MetadataRoute } from "next";

import { APP_DESCRIPTION, APP_ICONS } from "../lib/app-metadata";
import { HOME_PATH } from "../lib/paths";

/** Lets phones add the Operator app to the home screen and open it full screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.productName,
    short_name: BRAND.productName,
    description: APP_DESCRIPTION,
    start_url: HOME_PATH,
    scope: HOME_PATH,
    display: "standalone",
    background_color: BRAND.colours.page,
    theme_color: BRAND.colours.primary,
    icons: [...APP_ICONS],
  };
}
