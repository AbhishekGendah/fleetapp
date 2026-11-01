import { mergeFieldLabel, missingMergeFields } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { FileText } from "lucide-react";
import Link from "next/link";

import { appDb } from "../../../lib/app-db";
import { loadContractData } from "../../../lib/contracts/contract-data";
import { loadDefaultTemplate } from "../../../lib/contracts/templates";
import { CONTRACTS_PATH, rentalContractPreviewPath } from "../../../lib/paths";
import type { RentalDetail } from "../../../lib/rentals/rental-queries";
import type { RentalClock } from "../../../lib/rentals/rental-records";
import type { SignedInUser } from "../../../lib/require-user";

/** Until it is handed over, the contract can still be previewed and its gaps filled. */
const BEFORE_SIGNING = new Set(["draft", "booked"]);

/**
 * The rental's contract from the business's default template: a preview
 * PDF, and which details it uses that are not on file yet. Signing comes
 * next (Phase 3, slice 3).
 */
export async function ContractCard({
  rental,
  user,
  clock,
}: {
  rental: RentalDetail;
  user: SignedInUser;
  clock: RentalClock;
}) {
  if (!BEFORE_SIGNING.has(rental.status)) {
    return null;
  }
  const template = await loadDefaultTemplate(appDb, user.operatorId, "contract");
  if (!template) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Contract</CardTitle>
          <CardDescription>
            You have no contract template yet. Write yours once and it is filled in for each rental.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href={CONTRACTS_PATH}>Set up your contract</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  const data = await loadContractData(appDb, user.operatorId, rental.id, clock);
  const missing = data ? missingMergeFields(template.content, data) : [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Contract</CardTitle>
        <CardDescription>
          From your template “{template.name}” (version {template.latestVersion}), filled in with
          this rental’s details. The preview is marked as not issued.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {missing.length > 0 ? (
          <div className="text-attention text-sm" role="status">
            <p className="font-medium">Not on file yet, so shown as a gap in the contract:</p>
            <ul className="list-disc pl-5">
              {missing.map((key) => (
                <li key={key}>{mergeFieldLabel(key)}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <Button asChild variant="outline" className="w-full sm:w-auto sm:self-start">
          <a href={rentalContractPreviewPath(rental.id)} target="_blank" rel="noopener">
            <FileText aria-hidden />
            Preview contract
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
