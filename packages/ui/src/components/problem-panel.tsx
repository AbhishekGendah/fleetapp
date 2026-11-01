import type * as React from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";

/**
 * A page-sized message when something could not be shown: an error, a page
 * that does not exist. Its actions (Try again, a way home) come from the app.
 */
export function ProblemPanel(props: {
  title: string;
  message: string;
  actions?: React.ReactNode;
}): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-4">
      <Card>
        <CardHeader>
          <CardTitle>{props.title}</CardTitle>
          <CardDescription>{props.message}</CardDescription>
        </CardHeader>
        {props.actions ? (
          <CardContent className="flex flex-col gap-2 sm:flex-row">{props.actions}</CardContent>
        ) : null}
      </Card>
    </main>
  );
}
