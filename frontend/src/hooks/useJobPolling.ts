import { useCallback, useEffect, useRef, useState } from "react";
import type { JobEnvelope, JobEvent } from "../contracts/http";
import { isTerminalJob } from "../contracts/http";
import type { NewsTraceClient } from "../api/gateway";
import type { UiError } from "../domain/errors";
import { toUiError } from "../domain/errors";

export const VISIBLE_POLL_INTERVAL_MS = 2_000;
export const HIDDEN_POLL_INTERVAL_MS = 10_000;

export interface UseJobPollingOptions {
  client: NewsTraceClient;
  jobId: string | null;
  enabled: boolean;
  onJob?: (job: JobEnvelope) => void;
  onTerminal?: (job: JobEnvelope) => void;
  initialJob?: JobEnvelope | null;
}

export interface JobPollingState {
  job: JobEnvelope | null;
  error: UiError | null;
  cancel: () => Promise<void>;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AbortError")
  );
}

function pageIsHidden(): boolean {
  return (
    typeof document !== "undefined" &&
    document.visibilityState === "hidden"
  );
}

function pollDelay(): number {
  return pageIsHidden()
    ? HIDDEN_POLL_INTERVAL_MS
    : VISIBLE_POLL_INTERVAL_MS;
}

function mergeEvents(
  previous: readonly JobEvent[],
  incoming: readonly JobEvent[],
): JobEvent[] {
  const bySequence = new Map<number, JobEvent>();
  for (const event of previous) {
    if (!bySequence.has(event.seq)) {
      bySequence.set(event.seq, event);
    }
  }
  for (const event of incoming) {
    if (!bySequence.has(event.seq)) {
      bySequence.set(event.seq, event);
    }
  }
  return [...bySequence.values()].sort((a, b) => a.seq - b.seq);
}

function mergeJob(
  previous: JobEnvelope | null,
  incoming: JobEnvelope,
): JobEnvelope {
  const sameJob = previous !== null && previous.job_id === incoming.job_id;
  const events = mergeEvents(
    sameJob ? previous.events : [],
    incoming.events,
  );
  const highestEventSequence =
    events.length > 0
      ? Math.max(...events.map((event) => event.seq))
      : 0;
  return {
    ...incoming,
    events,
    next_event_seq: Math.max(
      incoming.next_event_seq,
      highestEventSequence + 1,
      1,
    ),
  };
}

function jobUpdatedAt(job: JobEnvelope): number {
  const parsed = Date.parse(job.updated_at);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Poll one job without inventing progress. The hook stops at any terminal
 * status, keeps a monotonic event cursor, and never lets a stale response
 * replace a terminal result.
 */
export function useJobPolling({
  client,
  jobId,
  enabled,
  onJob,
  onTerminal,
  initialJob,
}: UseJobPollingOptions): JobPollingState {
  const [job, setJobState] = useState<JobEnvelope | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const jobRef = useRef<JobEnvelope | null>(null);
  const mountedRef = useRef(true);
  const onJobRef = useRef(onJob);
  const onTerminalRef = useRef(onTerminal);
  const initialJobRef = useRef(initialJob);

  onJobRef.current = onJob;
  onTerminalRef.current = onTerminal;
  initialJobRef.current = initialJob;

  const commitJob = useCallback((next: JobEnvelope | null): void => {
    jobRef.current = next;
    if (mountedRef.current) {
      setJobState(next);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const candidate = initialJobRef.current;
    const initial =
      jobId !== null && candidate?.job_id === jobId
        ? candidate
        : null;
    commitJob(initial);
    if (mountedRef.current) {
      setError(null);
    }
  }, [jobId, commitJob]);

  const applyIncoming = useCallback(
    (incoming: JobEnvelope): void => {
      const previous = jobRef.current;
      if (previous !== null && previous.job_id !== incoming.job_id) {
        return;
      }

      if (previous !== null && previous.job_id === incoming.job_id) {
        if (isTerminalJob(previous)) {
          return;
        }
        if (jobUpdatedAt(incoming) < jobUpdatedAt(previous)) {
          return;
        }
      }

      const merged = mergeJob(previous, incoming);
      commitJob(merged);
      setError(null);

      onJobRef.current?.(merged);
      if (
        isTerminalJob(merged) &&
        (previous === null || !isTerminalJob(previous))
      ) {
        onTerminalRef.current?.(merged);
      }
    },
    [commitJob],
  );

  useEffect(() => {
    if (jobId === null || !enabled) {
      return;
    }

    const starting = jobRef.current;
    if (
      starting !== null &&
      starting.job_id === jobId &&
      isTerminalJob(starting)
    ) {
      return;
    }

    let cancelled = false;
    let inFlight = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;
    let afterEventSeq =
      starting !== null && starting.job_id === jobId
        ? starting.next_event_seq
        : 0;

    const clearTimer = (): void => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };

    const scheduleNext = (): void => {
      clearTimer();
      if (cancelled) {
        return;
      }
      const current = jobRef.current;
      if (
        current !== null &&
        current.job_id === jobId &&
        isTerminalJob(current)
      ) {
        return;
      }
      timer = window.setTimeout(() => {
        void poll();
      }, pollDelay());
    };

    const poll = async (): Promise<void> => {
      if (cancelled || inFlight) {
        return;
      }
      const current = jobRef.current;
      if (
        current !== null &&
        current.job_id === jobId &&
        isTerminalJob(current)
      ) {
        return;
      }

      inFlight = true;
      controller = new AbortController();
      try {
        const next = await client.getJob(
          jobId,
          afterEventSeq,
          controller.signal,
        );
        if (cancelled || next.job_id !== jobId) {
          return;
        }
        const responseHighest =
          next.events.length > 0
            ? Math.max(...next.events.map((event) => event.seq))
            : 0;
        afterEventSeq = Math.max(
          afterEventSeq,
          next.next_event_seq,
          responseHighest,
        );
        applyIncoming(next);
        if (!isTerminalJob(next)) {
          scheduleNext();
        }
      } catch (pollError) {
        if (
          cancelled ||
          controller?.signal.aborted === true ||
          isAbortError(pollError)
        ) {
          return;
        }
        if (mountedRef.current) {
          setError(
            toUiError(
              pollError,
              "The job status could not be refreshed. The last known activity is still shown.",
            ),
          );
        }
        scheduleNext();
      } finally {
        inFlight = false;
        controller = null;
      }
    };

    const handleVisibilityChange = (): void => {
      if (inFlight) {
        return;
      }
      const current = jobRef.current;
      if (
        current !== null &&
        current.job_id === jobId &&
        isTerminalJob(current)
      ) {
        return;
      }
      scheduleNext();
    };

    if (typeof document !== "undefined") {
      document.addEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
    }
    void poll();

    return () => {
      cancelled = true;
      clearTimer();
      controller?.abort();
      if (typeof document !== "undefined") {
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      }
    };
  }, [client, jobId, enabled, applyIncoming]);

  const cancel = useCallback(async (): Promise<void> => {
    if (jobId === null) {
      return;
    }
    try {
      const next = await client.cancelJob(jobId);
      if (mountedRef.current && next.job_id === jobId) {
        applyIncoming(next);
      }
    } catch (cancelError) {
      if (isAbortError(cancelError) || !mountedRef.current) {
        return;
      }
      setError(
        toUiError(
          cancelError,
          "The cancellation request could not be delivered. The job may still be running.",
        ),
      );
    }
  }, [client, jobId, applyIncoming]);

  return { job, error, cancel };
}
