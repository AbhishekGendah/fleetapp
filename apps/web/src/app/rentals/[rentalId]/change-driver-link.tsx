import { Button } from "@fleetapp/ui/button";
import { UserCheck } from "lucide-react";
import Link from "next/link";

import { rentalDriverChangePath } from "../../../lib/paths";
import type { RentalDetail } from "../../../lib/rentals/rental-queries";
import type { ReturnProgress } from "./handover-card";

/**
 * On a business's rental whose car is out (mockup 6): Change driver, or
 * Continue driver change while one is under way. Not offered while a return
 * or a car swap has the car's check-in.
 */
export function ChangeDriverLink(props: { rental: RentalDetail; progress: ReturnProgress | null }) {
  const { progress } = props;
  if (!progress || progress.inProgressId || progress.isSwapUnderWay) {
    return null;
  }
  const isUnderWay = progress.isDriverChangeUnderWay;
  return (
    <Button asChild variant="outline" className="w-full sm:w-auto sm:self-start">
      <Link href={rentalDriverChangePath(props.rental.id, isUnderWay ? "check-in" : "start")}>
        <UserCheck aria-hidden />
        {isUnderWay ? "Continue driver change" : "Change driver"}
      </Link>
    </Button>
  );
}
