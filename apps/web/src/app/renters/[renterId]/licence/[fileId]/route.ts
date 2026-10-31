import { redirectToLicenceImage } from "../../../../../lib/files/licence-image-route";
import { openLicenceScan } from "../../../../../lib/renters/licence-scans";

export const runtime = "nodejs";

/** Opens a licence scan for a 5-minute look; every opening is logged (rule 8). */
export function GET(
  _request: Request,
  props: { params: Promise<{ renterId: string; fileId: string }> },
): Promise<never> {
  return redirectToLicenceImage(props.params, openLicenceScan);
}
