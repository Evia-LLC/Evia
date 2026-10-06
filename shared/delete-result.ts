/**
 * P1-T10 — durable deletion result contract.
 *
 * Chosen location: a new file (`shared/delete-result.ts`) rather than extending
 * `shared/types.ts`, so the deletion lifecycle stays a self-contained contract
 * the backend, the client and the tests import without pulling the whole domain
 * model. Like `types.ts`, nothing in here may import anything else.
 *
 * Three states, and who produces each:
 *
 * - `completed` — the producer is the transactional store (P1-T09). Account
 *   rows and encrypted blobs are removed in one Postgres transaction, so the
 *   operation either commits fully or rolls back. `ok` maps to `completed`;
 *   a throw/rollback maps to `failed` at the route boundary. UI: success
 *   screen; for account scope the session is cleared.
 * - `pending` — reserved for Phase 4 durable jobs (object storage, managed
 *   identity, backup rotation). The constructor below is the explicit
 *   forward-compatible path: it REQUIRES a non-empty `outstanding` list, so a
 *   backend can only return `pending` when work is genuinely outstanding. The
 *   current transactional path never produces it (its outstanding list is
 *   always empty). UI: receipt/status screen, session preserved, export still
 *   available. Never a complete-erasure claim while cleanup is outstanding.
 * - `failed` — the producer is the route's catch block (or a 404 for a missing
 *   item): the transaction rolled back or nothing was touched, so the account
 *   state is preserved. UI: error screen, stays signed in, data intact, export
 *   link intact, retry possible. Never a misleading success screen.
 */

/** What the deletion acted on. Body readings are `scan`, like skin readings. */
export type DeletionScope = "account" | "photo" | "scan";

export type DeletionStatus = "completed" | "pending" | "failed";

/**
 * All durable work is done. For account scope this means the user row, owned
 * products, encrypted blobs and every row cascading from users(id) —
 * sessions, profiles, scans, photos, routine, memories, consent history —
 * committed in one transaction.
 */
export interface DeletionCompleted {
  status: "completed";
  scope: DeletionScope;
  /** Encrypted blobs removed together with the rows. */
  blobsShredded: number;
  /**
   * False for owner-scoped no-ops (e.g. deleting another account's scan
   * answers 200 without touching it): nothing was removed, and the message
   * says so rather than claiming a deletion.
   */
  deleted: boolean;
  /** Deleted row id for item scope; absent for account scope. */
  id?: string;
  deletedAt: string;
  message: string;
}

/**
 * Durable work remains outstanding (Phase 4 jobs). The message must never
 * claim complete erasure; the flags keep the session and the export alive.
 */
export interface DeletionPending {
  status: "pending";
  scope: DeletionScope;
  /** Genuinely outstanding durable-job refs. Never empty — see constructor. */
  outstanding: string[];
  message: string;
  exportAvailable: true;
  sessionPreserved: true;
}

/** Nothing was deleted: the transaction rolled back or was never entered. */
export interface DeletionFailed {
  status: "failed";
  scope: DeletionScope;
  /** Sanitised, user-facing — never a stack trace or driver detail. */
  error: string;
  retryable: true;
  exportAvailable: true;
}

export type DeleteResult = DeletionCompleted | DeletionPending | DeletionFailed;

/** Account deletion answers with the full contract; item deletes use it too. */
export type AccountDeleteResult = DeleteResult;

export function isDeletionCompleted(
  result: DeleteResult,
): result is DeletionCompleted {
  return result.status === "completed";
}

export function isDeletionPending(
  result: DeleteResult,
): result is DeletionPending {
  return result.status === "pending";
}

export function isDeletionFailed(
  result: DeleteResult,
): result is DeletionFailed {
  return result.status === "failed";
}

/**
 * Maps the P1-T09 transactional outcome to the contract. The atomic production
 * path completes with `blobsFailed: 0`; `ok` always means the transaction
 * committed, so it is always `completed`.
 */
export function completedAccountDeletion(
  blobsShredded: number,
): DeletionCompleted {
  const count =
    Number.isFinite(blobsShredded) && blobsShredded > 0
      ? Math.floor(blobsShredded)
      : 0;
  return {
    status: "completed",
    scope: "account",
    blobsShredded: count,
    deleted: true,
    deletedAt: new Date().toISOString(),
    message:
      `Your account and all attached data were permanently deleted, ` +
      `including ${count} stored photo file${count === 1 ? "" : "s"}. You are signed out.`,
  };
}

export function completedItemDeletion(
  scope: "photo" | "scan",
  id: string,
  options: { deleted?: boolean; blobsShredded?: number } = {},
): DeletionCompleted {
  const deleted = options.deleted ?? true;
  const blobs = options.blobsShredded ?? (deleted ? 1 : 0);
  const noun = scope === "photo" ? "Photo" : "Scan";
  const doneMessage =
    blobs > 0
      ? `${noun} deleted and its stored image shredded.`
      : `${noun} deleted. No stored image was attached.`;
  return {
    status: "completed",
    scope,
    blobsShredded: blobs,
    deleted,
    id,
    deletedAt: new Date().toISOString(),
    message: deleted
      ? doneMessage
      : "No matching item was found for this account; nothing was deleted.",
  };
}

/**
 * Forward-compatible pending path for Phase 4 durable jobs. Throws on an
 * empty `outstanding` list: `pending` must only ever describe genuinely
 * outstanding work, never the transactional store (which completes or rolls
 * back atomically and therefore has nothing outstanding to report).
 */
export function pendingDeletion(
  scope: DeletionScope,
  outstanding: string[],
): DeletionPending {
  if (!Array.isArray(outstanding) || outstanding.length === 0) {
    throw new Error(
      "pendingDeletion requires at least one outstanding durable job.",
    );
  }
  return {
    status: "pending",
    scope,
    outstanding: [...outstanding],
    message:
      `Deletion is pending: ${outstanding.length} background task${outstanding.length === 1 ? "" : "s"} ` +
      `still outstanding. Your data is not yet fully erased. You stay signed in and your export remains available.`,
    exportAvailable: true,
    sessionPreserved: true,
  };
}

/** Sanitises any thrown value into a user-facing, retryable failure receipt. */
export function failedDeletion(
  scope: DeletionScope,
  cause: unknown,
): DeletionFailed {
  let error =
    "The deletion could not be completed. Your account and data are intact.";
  const raw =
    typeof cause === "string" ? cause : cause instanceof Error ? cause.message : "";
  // First line of the message only — never the stack, never driver internals.
  const firstLine = raw.split("\n", 1)[0].trim();
  if (firstLine) error = firstLine.slice(0, 300);
  return {
    status: "failed",
    scope,
    error,
    retryable: true,
    exportAvailable: true,
  };
}
