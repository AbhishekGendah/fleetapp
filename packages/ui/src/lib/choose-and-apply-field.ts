/**
 * The name of a "choose one" form's box. In its own file, not the component's:
 * server code reads it, and a constant taken from a browser-only ("use client")
 * file reaches the server as a stand-in, not the text.
 */
export const CHOSEN_FIELD = "chosen";
