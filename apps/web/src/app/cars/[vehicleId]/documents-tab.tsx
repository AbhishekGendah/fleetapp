import { formatDateTimeInTimeZone } from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { FormDialog } from "@fleetapp/ui/form-dialog";

import { appDb } from "../../../lib/app-db";
import { listCarDocuments } from "../../../lib/files/car-files";
import { carFilePath } from "../../../lib/paths";
import type { SignedInUser } from "../../../lib/require-user";
import type { VehicleDetail } from "../../../lib/vehicles/vehicle-queries";
import { DocumentUploadForm } from "./document-upload-form";
import { removeCarFileAction } from "./file-actions";

const PDF = "application/pdf";

/** A car's documents: inspection reports and anything else, each with the name it was given. */
export async function DocumentsTab({
  vehicle,
  user,
}: {
  vehicle: VehicleDetail;
  user: SignedInUser;
}) {
  const documents = await listCarDocuments(appDb, user.operatorId, vehicle.id);
  const isEditable = vehicle.archivedAt === null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents</CardTitle>
        <CardDescription>
          PDFs or images: inspection reports, service books and the like. Rego papers, insurance
          papers and receipts attach to their own record instead. Anything showing someone's
          licence, such as a transfer form, goes on the purchase or sale, where it is kept
          privately.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isEditable ? (
          <FormDialog triggerLabel="Add a document" title="Add a document">
            <DocumentUploadForm vehicleId={vehicle.id} />
          </FormDialog>
        ) : null}
        {documents.length === 0 ? (
          <p className="text-muted-foreground text-sm">No documents yet.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {documents.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                <div>
                  <a
                    href={carFilePath(vehicle.id, document.id)}
                    target="_blank"
                    rel="noopener"
                    className="text-teal font-medium hover:underline"
                  >
                    {document.label}
                  </a>
                  <p className="text-muted-foreground text-xs">
                    {document.contentType === PDF ? "PDF" : "Image"} · added{" "}
                    {formatDateTimeInTimeZone(document.createdAt, user.operatorTimezone)}
                  </p>
                </div>
                {isEditable ? (
                  <ActionButton
                    action={removeCarFileAction.bind(null, vehicle.id, document.id)}
                    label="Remove"
                    pendingLabel="Removing…"
                    variant="ghost"
                    size="sm"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
