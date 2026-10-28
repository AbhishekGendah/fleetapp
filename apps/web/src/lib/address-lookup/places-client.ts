import { env } from "../../env";
import { createGooglePlacesClient } from "./google-places";

/** The Operator app's one Google Places client. Server only: it holds the key. */
export const placesClient = createGooglePlacesClient(env.GOOGLE_PLACES_API_KEY);
