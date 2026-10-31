"use client";

import { CameraCapture } from "@fleetapp/ui/camera-capture";
import { FilePicker } from "@fleetapp/ui/file-picker";
import { Camera, FileUp } from "lucide-react";

/** What a photo from the camera is called while it is sent; never stored. */
const CAMERA_FILE_NAME = "photo.jpg";

/**
 * "Take photo" (the in-app camera) and "Choose file", side by side, for a
 * slot that holds one file, such as one side of a licence. The last photo
 * taken is the keeper.
 */
export function PhotoOrFileButtons(props: {
  hasFile: boolean;
  isSending: boolean;
  /** The kinds of file the slot takes, e.g. "image/jpeg,application/pdf". */
  accept: string;
  onFileChosen: (file: File) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      <CameraCapture
        triggerLabel={props.hasFile ? "Retake" : "Take photo"}
        triggerIcon={<Camera aria-hidden />}
        onPhotosTaken={(photos) => {
          const photo = photos.at(-1);
          if (photo) {
            props.onFileChosen(new File([photo], CAMERA_FILE_NAME, { type: photo.type }));
          }
        }}
      />
      <FilePicker
        label="Choose file"
        accept={props.accept}
        isDisabled={props.isSending}
        icon={<FileUp aria-hidden />}
        onFilesChosen={(chosen) => {
          const file = chosen[0];
          if (file) {
            props.onFileChosen(file);
          }
        }}
      />
    </div>
  );
}
