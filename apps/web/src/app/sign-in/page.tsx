import type { Metadata } from "next";
import { USER_SESSION, signInNotice } from "@fleetapp/auth/login-policy";

import { SignInScreen } from "./sign-in-screen";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <SignInScreen notice={signInNotice(await props.searchParams, USER_SESSION)} />;
}
