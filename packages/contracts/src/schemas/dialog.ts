import { z } from 'zod';

/**
 * Native dialog contracts.
 *
 * `DialogKind` is the single source of truth for the `kind` argument of
 * `cmd_dialog_ask` — unknown kinds are rejected instead of coerced to a
 * default (which would silently downgrade an "error" dialog to "info").
 *
 * @see STANDARDS.md §10 IPC + Rust contract alignment
 */

/** Accepted dialog kinds for `cmd_dialog_ask`. */
export const DialogKindSchema = z.enum(['info', 'warning', 'error', 'confirm']);

export type DialogKind = z.infer<typeof DialogKindSchema>;
