import { formatDateTimeInTimeZone } from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { FormDialog } from "@fleetapp/ui/form-dialog";
import { ImageViewer } from "@fleetapp/ui/image-viewer";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";
import { Plus, Trash2 } from "lucide-react";

import { appDb } from "../../../lib/app-db";
import { listCarDocuments } from "../../../lib/files/car-files";
import { carFilePath } from "../../../lib/paths";
import type { SignedInUser } from "../../../lib/require-user";
import type { VehicleDetail } from "../../../lib/vehicles/vehicle-queries";
import { DocumentUploadForm } from "./document-upload-form";
import { FileLink, isPdf } from "../../../components/file-link";
import { removeCarFileAction } from "./file-actions";

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
  const images = documents.filter((document) => !isPdf(document.contentType));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents</CardTitle>
        <CardDescription>
          PDFs or images: inspection reports, service books and the like. Rego papers, insurance
          papers and receipts attach to their own record instead. Anything showing someone’s
          licence, such as a transfer form, goes on the purchase or sale, where it is kept
          privately.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isEditable ? (
          <FormDialog
            triggerLabel="Add a document"
            triggerIcon={<Plus aria-hidden />}
            isMainAction
            title="Add a document"
          >
            <DocumentUploadForm vehicleId={vehicle.id} />
          </FormDialog>
        ) : null}
        {documents.length === 0 ? (
          <p className="text-muted-foreground text-sm">No documents yet.</p>
        ) : (
          <ImageViewer
            images={images.map((document) => ({
              src: carFilePath(vehicle.id, document.id),
              label: document.label,
            }))}
          >
            <RecordList label="Documents">
              {documents.map((document) => (
                <RecordItem
                  key={document.id}
                  title={
                    <FileLink
                      href={carFilePath(vehicle.id, document.id)}
                      label={document.label}
                      contentType={document.contentType}
                      imageIndex={images.indexOf(document)}
                    />
                  }
                  details={
                    <p>
                      {isPdf(document.contentType) ? "PDF" : "Image"} · added{" "}
                      {formatDateTimeInTimeZone(document.createdAt, user.operatorTimezone)}
                    </p>
                  }
                  actions={
                    isEditable ? (
                      <ActionButton
                        action={removeCarFileAction.bind(null, vehicle.id, document.id)}
                        label="Remove"
                        pendingLabel="Removing…"
                        variant="danger"
                        icon={<Trash2 aria-hidden />}
                      />
                    ) : undefined
                  }
                />
              ))}
            </RecordList>
          </ImageViewer>
        )}
      </CardContent>
    </Card>
  );
}
