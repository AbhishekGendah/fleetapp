"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { BRAND } from "../brand";
import { Button } from "./button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";

/** Remembered on this phone only: dismissing it here does not hide it on another device. */
const DISMISSED_STORAGE_KEY = "install-app-hint-dismissed";
const DISMISSED_VALUE = "yes";

const STANDALONE_QUERY = "(display-mode: standalone)";
/** Phones and tablets. A desktop can install the app too, but the guide is not worth the space there. */
const TOUCH_SCREEN_QUERY = "(pointer: coarse)";
const APPLE_MOBILE_PATTERN = /iPhone|iPad|iPod/;
/** iPads report themselves as Macs; a touch screen tells them apart. */
const IPAD_AS_MAC_PATTERN = /Macintosh/;
const MINIMUM_IPAD_TOUCH_POINTS = 2;

/** "apple": steps for Safari's Share menu. "prompt": the phone can install it with one tap. */
export type InstallAppHintKind = "apple" | "prompt";

/** Chrome's install event. Not in TypeScript's DOM types because only Chromium browsers have it. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

function isInstallPromptEvent(event: Event): event is InstallPromptEvent {
  return "prompt" in event && typeof event.prompt === "function";
}

function isOpenedFromHomeScreen(): boolean {
  const isAppleStandalone = "standalone" in navigator && navigator.standalone === true;
  return isAppleStandalone || window.matchMedia(STANDALONE_QUERY).matches;
}

function wasDismissedBefore(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_STORAGE_KEY) === DISMISSED_VALUE;
  } catch (error) {
    // Private browsing can block storage; the guide then just shows again next time.
    console.warn("Install guide: could not read storage", error instanceof Error ? error.name : "");
    return false;
  }
}

function rememberDismissed(): void {
  try {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, DISMISSED_VALUE);
  } catch (error) {
    console.warn(
      "Install guide: could not write storage",
      error instanceof Error ? error.name : "",
    );
  }
}

function shouldOfferInstall(): boolean {
  return (
    window.matchMedia(TOUCH_SCREEN_QUERY).matches &&
    !isOpenedFromHomeScreen() &&
    !wasDismissedBefore()
  );
}

function isAppleMobile(): boolean {
  const { userAgent, maxTouchPoints } = navigator;
  return (
    APPLE_MOBILE_PATTERN.test(userAgent) ||
    (IPAD_AS_MAC_PATTERN.test(userAgent) && maxTouchPoints >= MINIMUM_IPAD_TOUCH_POINTS)
  );
}

/** These facts do not change while the page is open, so there is nothing to subscribe to. */
function subscribeToNothing(): () => void {
  return () => undefined;
}

function isFalseOnServer(): boolean {
  return false;
}

interface InstallAppHintCardProps {
  kind: InstallAppHintKind;
  onInstall?: () => void;
  onDismiss: () => void;
}

/** The guide itself, without the checks for when to show it. Shown as-is in the component catalogue. */
export function InstallAppHintCard({ kind, onInstall, onDismiss }: InstallAppHintCardProps) {
  const isPrompt = kind === "prompt";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add {BRAND.productName} to your home screen</CardTitle>
        <CardDescription>
          {isPrompt ? (
            "It then opens full screen with its own icon, like any other app."
          ) : (
            <>
              It then opens full screen with its own icon. In Safari, tap the Share button (the
              square with an arrow), then <strong>Add to Home Screen</strong>.
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {isPrompt ? <Button onClick={onInstall}>Install</Button> : null}
        <Button variant={isPrompt ? "ghost" : "outline"} onClick={onDismiss}>
          {isPrompt ? "Not now" : "Got it"}
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * A short guide to putting the app on the phone's home screen. Shown only on
 * a phone or tablet that has not already done it and has not dismissed it.
 * Android offers its own install prompt, which the Install button opens;
 * iPhones have no prompt, so they get the Share menu steps instead.
 */
export function InstallAppHint() {
  const isOfferable = useSyncExternalStore(subscribeToNothing, shouldOfferInstall, isFalseOnServer);
  const isApple = useSyncExternalStore(subscribeToNothing, isAppleMobile, isFalseOnServer);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    function handleInstallPromptReady(event: Event): void {
      if (!isInstallPromptEvent(event)) {
        return;
      }
      // Holds back the browser's own banner so the prompt opens from this guide instead.
      event.preventDefault();
      setInstallPrompt(event);
    }
    function handleInstalled(): void {
      setInstallPrompt(null);
    }
    window.addEventListener("beforeinstallprompt", handleInstallPromptReady);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPromptReady);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  function handleDismiss(): void {
    rememberDismissed();
    setIsDismissed(true);
  }

  async function handleInstall(): Promise<void> {
    if (!installPrompt) {
      return;
    }
    // A prompt can only be opened once; the browser fires a fresh one if it is declined.
    setInstallPrompt(null);
    await installPrompt.prompt();
  }

  if (!isOfferable || isDismissed) {
    return null;
  }
  if (isApple) {
    return <InstallAppHintCard kind="apple" onDismiss={handleDismiss} />;
  }
  if (installPrompt) {
    return (
      <InstallAppHintCard
        kind="prompt"
        onInstall={() => void handleInstall()}
        onDismiss={handleDismiss}
      />
    );
  }
  return null;
}
