"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** Big enough for a phone camera to read from arm's length. */
export const QR_CODE_WIDTH_PX = 240;

/**
 * A QR code for a phone to scan: an authenticator app's setup, or a
 * Renter's link shown on the Operator's phone. Made in the browser, so the
 * text never leaves it.
 */
export function QrCode(props: { value: string; label: string; widthPx?: number }) {
  const width = props.widthPx ?? QR_CODE_WIDTH_PX;
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    QRCode.toDataURL(props.value, { width })
      .then((url) => {
        if (isCurrent) {
          setDataUrl(url);
        }
      })
      .catch((error: unknown) => {
        console.error("Drawing a QR code failed", error instanceof Error ? error.name : "");
      });
    return () => {
      isCurrent = false;
    };
  }, [props.value, width]);

  // A plain img: a data URL made in the browser is nothing next/image can optimise.
  return dataUrl ? (
    <img
      src={dataUrl}
      alt={props.label}
      width={width}
      height={width}
      className="mx-auto rounded-md bg-white p-2"
    />
  ) : (
    <div
      role="img"
      aria-label={props.label}
      style={{ width, height: width }}
      className="bg-muted mx-auto rounded-md"
    />
  );
}
