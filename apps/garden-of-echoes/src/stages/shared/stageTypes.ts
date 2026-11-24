// Shared types of the stage content validators (design 4.2). A validator never throws. It returns the content or
// the issues, and each issue names the path of the field at fault.

/** One problem in a content file: the path of the field, and one readable line. */
export interface ContentIssue {
  readonly path: string;
  readonly message: string;
}

export type ContentResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly ContentIssue[] };
