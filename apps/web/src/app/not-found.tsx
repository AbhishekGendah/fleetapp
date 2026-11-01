import { Button } from "@fleetapp/ui/button";
import { ProblemPanel } from "@fleetapp/ui/problem-panel";
import Link from "next/link";

import { HOME_PATH } from "../lib/paths";

export default function NotFoundPage() {
  return (
    <ProblemPanel
      title="Page not found"
      message="This page doesn't exist, or it isn't yours to see."
      actions={
        <Button asChild className="w-full sm:w-auto">
          <Link href={HOME_PATH}>Go to the start</Link>
        </Button>
      }
    />
  );
}
