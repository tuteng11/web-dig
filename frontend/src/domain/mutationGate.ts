export interface SubmissionGate {
  begin(): number | null;
  end(token: number): boolean;
  reset(): void;
  isHeld(): boolean;
}

export interface MutationIdTracker {
  forPayload(signature: string): string;
  settle(signature: string): void;
  clear(): void;
}

/**
 * Synchronous single-submission lock.
 *
 * A submission takes the gate before awaiting its request, so a second click
 * cannot start a parallel mutation. Every holder receives a unique token;
 * releasing with a stale token is ignored, which keeps a superseded request
 * from unlocking a newer submission.
 */
export function createSubmissionGate(): SubmissionGate {
  let heldToken: number | null = null;
  let nextToken = 1;

  return {
    begin() {
      if (heldToken !== null) {
        return null;
      }
      const token = nextToken;
      nextToken += 1;
      heldToken = token;
      return token;
    },

    end(token) {
      if (heldToken === null || heldToken !== token) {
        return false;
      }
      heldToken = null;
      return true;
    },

    reset() {
      heldToken = null;
    },

    isHeld() {
      return heldToken !== null;
    },
  };
}

/**
 * Request-ID memo for explicit retries.
 *
 * Every distinct payload keeps its own UUID until a definitive job response
 * settles that signature. If one response is lost, another mutation in the
 * meantime cannot displace its record, so an explicit retry still reuses the
 * original UUID and preserves backend idempotency.
 */
export function createMutationIdTracker(
  generateId: () => string,
): MutationIdTracker {
  const pending = new Map<string, string>();

  return {
    forPayload(signature) {
      const existing = pending.get(signature);
      if (existing !== undefined) {
        return existing;
      }
      const id = generateId();
      pending.set(signature, id);
      return id;
    },

    settle(signature) {
      pending.delete(signature);
    },

    clear() {
      pending.clear();
    },
  };
}

/**
 * Stable signature for a mutation kind and payload.
 *
 * Callers pass payload objects in a fixed key order, so JSON serialization is
 * deterministic without an extra canonicalization dependency.
 */
export function mutationSignature(
  kind: string,
  payload: Record<string, unknown>,
): string {
  return `${kind}:${JSON.stringify(payload)}`;
}
