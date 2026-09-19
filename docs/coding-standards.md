# AGS Coding Standards

## Communication
- Be direct and concise. No fluff.
- For architectural decisions, briefly state the tradeoff.
- If you spot a code smell in adjacent code, flag it. Don't silently
  fix unrelated code.
- If a task is ambiguous, ask ONE clarifying question before proceeding.

## Non-negotiables
- DRY: if similar logic appears more than once, extract it. Flag it.
- No magic numbers or hardcoded strings; use named constants.
- Guard clauses and early returns over deep nesting.
- Pure functions wherever possible; no hidden side effects.
- Immutability: never mutate function arguments; return new values.
- One function, one job. If the name needs "and", split it.
- Functions over about 40 lines are doing too much. Flag them.

## Naming
- Specific names: getUserInvoices(), not getData().
- No abbreviations unless universal (id, url, api, db).
- Booleans prefixed: isLoading, hasError, canEdit, shouldRetry.
- Event handlers prefixed: handleSubmit, handleStatusChange.
- Arrays are plural nouns: jobs, customerIds, lineItems.
- No single-letter variables outside loop counters.

## Error handling
- Never swallow errors in empty catch blocks; log or rethrow.
- Validate all inputs at system boundaries.
- Fail fast: missing config or required data throws on startup.

## Comments
- Comment the WHY, never the WHAT.
- If a comment explains what code does, rename things instead.
- Mark temporary code TODO, FIXME or HACK with a brief reason.

## Security
- No secrets, keys or credentials in code or committed files.
- Parameterised queries only; never concatenate user input.
- Never log passwords, tokens or personal information.

## Git
- Conventional commits: feat(scope):, fix(scope):, chore:, refactor:,
  docs:
- Small, single-purpose commits.

## TypeScript
- strict: true. No any; use unknown and narrow it.
- Explicit return types on all exported functions.
- Zod for runtime validation at system boundaries.
- Use utility types: Partial, Pick, Omit, Required.

## Flag proactively
- Duplicate logic that could be extracted.
- A function doing more than one thing.
- A magic number that should be a constant.
- An any that could be typed properly.
- Missing edge cases: empty array, null, undefined, network failure.
- A pattern inconsistent with the rest of the file.
