import { redirectToLicenceImage } from "../../../../../../lib/files/licence-image-route";
import { openSubmittedPhoto } from "../../../../../../lib/renter-links/reviews";

export const runtime = "nodejs";

/** Opens a licence photo a Renter sent, while it waits for review; every opening is logged (rule 8). */
export function GET(
  _request: Request,
  props: { params: Promise<{ renterId: string; fileId: string }> },
): Promise<never> {
  return redirectToLicenceImage(props.params, openSubmittedPhoto);
}
