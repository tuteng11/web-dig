import type { GraphResult, NodeDetails } from "../contracts/newsTrace";
import type {
  AddDiscoveriesInput,
  AskQuestionInput,
  ExpandNodeInput,
  JobEnvelope,
  StartResearchInput,
} from "../contracts/http";
import { validateJobEnvelope } from "./jobValidation";

export const DEFAULT_API_BASE = "/api/v1";

export class GatewayError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number | null;
  readonly requestId: string | null;

  constructor(
    code: string,
    message: string,
    options: {
      retryable?: boolean;
      status?: number | null;
      requestId?: string | null;
    } = {},
  ) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status ?? null;
    this.requestId = options.requestId ?? null;
  }
}

export interface NewsTraceClient {
  startResearch(
    input: StartResearchInput,
    signal?: AbortSignal,
  ): Promise<JobEnvelope>;
  /**
   * Fetch a job, optionally with events appended after an exclusive cursor.
   *
   * `afterEventSeq` is exclusive: the server returns events with
   * `seq > afterEventSeq`. Pass the highest sequence actually received, not
   * `JobEnvelope.next_event_seq` (which is the next sequence to allocate).
   */
  getJob(
    jobId: string,
    afterEventSeq?: number,
    signal?: AbortSignal,
  ): Promise<JobEnvelope>;
  cancelJob(jobId: string, signal?: AbortSignal): Promise<JobEnvelope>;
  getGraph(researchId: string, signal?: AbortSignal): Promise<GraphResult>;
  getNodeDetails(
    researchId: string,
    nodeId: string,
    signal?: AbortSignal,
  ): Promise<NodeDetails>;
  expandNode(
    researchId: string,
    input: ExpandNodeInput,
    signal?: AbortSignal,
  ): Promise<JobEnvelope>;
  askQuestion(
    researchId: string,
    input: AskQuestionInput,
    signal?: AbortSignal,
  ): Promise<JobEnvelope>;
  addDiscoveries(
    researchId: string,
    input: AddDiscoveriesInput,
    signal?: AbortSignal,
  ): Promise<JobEnvelope>;
}

export interface GatewayClientOptions {
  base?: string;
  fetchImpl?: typeof fetch;
}

interface ErrorEnvelopeLike {
  code: string;
  message: string;
  retryable: boolean;
  requestId: string | null;
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
}

const MAX_SERVER_MESSAGE_LENGTH = 600;
const MAX_ERROR_CODE_LENGTH = 80;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toSafeServerMessage(value: string): string {
  return value.trim().slice(0, MAX_SERVER_MESSAGE_LENGTH);
}

function readErrorEnvelope(payload: unknown): ErrorEnvelopeLike | null {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return null;
  }

  const { code, message, retryable } = payload.error;
  if (
    typeof code !== "string" ||
    code.trim().length === 0 ||
    typeof message !== "string" ||
    message.trim().length === 0
  ) {
    return null;
  }

  return {
    code: code.trim().slice(0, MAX_ERROR_CODE_LENGTH),
    message: toSafeServerMessage(message),
    retryable: retryable === true,
    requestId:
      typeof payload.request_id === "string" && payload.request_id.length > 0
        ? payload.request_id
        : null,
  };
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AbortError")
  );
}

/**
 * Generate a UUID request ID for idempotent backend operations.
 *
 * `crypto.randomUUID()` needs a secure context, which localhost provides.
 * The `getRandomValues` fallback keeps local non-secure HTTP previews usable
 * without weakening the UUID shape the gateway contract requires.
 */
export function newRequestId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
    return [
      hex.slice(0, 4).join(""),
      hex.slice(4, 6).join(""),
      hex.slice(6, 8).join(""),
      hex.slice(8, 10).join(""),
      hex.slice(10, 16).join(""),
    ].join("-");
  }

  throw new Error(
    "This browser cannot generate a secure request ID for the gateway.",
  );
}

export function createGatewayClient({
  base = DEFAULT_API_BASE,
  fetchImpl,
}: GatewayClientOptions = {}): NewsTraceClient {
  const normalizedBase =
    base.trim().replace(/\/+$/, "") || DEFAULT_API_BASE;

  async function requestJson(
    path: string,
    { method = "GET", body, signal }: RequestOptions = {},
  ): Promise<unknown> {
    if (signal?.aborted) {
      throw abortError();
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;
    try {
      const doFetch = fetchImpl ?? fetch;
      response = await doFetch(`${normalizedBase}${path}`, {
        method,
        headers,
        credentials: "same-origin",
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (isAbortError(error, signal)) {
        throw error;
      }
      throw new GatewayError(
        "NETWORK_ERROR",
        "Could not reach the News Trace gateway. Check that the gateway is running and try again.",
        { retryable: true },
      );
    }

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      if (isAbortError(error, signal)) {
        throw error;
      }
      throw new GatewayError(
        "MALFORMED_RESPONSE",
        "The gateway response could not be read safely.",
        { retryable: true, status: response.status },
      );
    }

    let payload: unknown;
    if (text.trim().length > 0) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        throw new GatewayError(
          "MALFORMED_RESPONSE",
          "The gateway returned a response that was not valid JSON.",
          { retryable: false, status: response.status },
        );
      }
    }

    if (!response.ok) {
      const errorEnvelope = readErrorEnvelope(payload);
      if (errorEnvelope) {
        throw new GatewayError(
          errorEnvelope.code,
          errorEnvelope.message,
          {
            retryable: errorEnvelope.retryable,
            status: response.status,
            requestId: errorEnvelope.requestId,
          },
        );
      }

      throw new GatewayError(
        "MALFORMED_RESPONSE",
        "The gateway returned an error response that could not be read safely.",
        { retryable: false, status: response.status },
      );
    }

    if (payload === undefined) {
      throw new GatewayError(
        "MALFORMED_RESPONSE",
        "The gateway returned an empty response.",
        { retryable: false, status: response.status },
      );
    }

    return payload;
  }

  async function requestJob(
    path: string,
    options?: RequestOptions,
  ): Promise<JobEnvelope> {
    const payload = await requestJson(path, options);
    const validation = validateJobEnvelope(payload);
    if (!validation.ok) {
      throw new GatewayError(
        "MALFORMED_RESPONSE",
        "The gateway returned a job response that failed validation.",
        { retryable: false },
      );
    }
    return validation.value;
  }

  return {
    startResearch(input, signal) {
      return requestJob("/research", {
        method: "POST",
        body: input,
        signal,
      });
    },

    getJob(jobId, afterEventSeq, signal) {
      const cursor =
        afterEventSeq !== undefined &&
        Number.isInteger(afterEventSeq) &&
        afterEventSeq >= 0
          ? `?after_event_seq=${encodeURIComponent(String(afterEventSeq))}`
          : "";
      return requestJob(`/jobs/${encodeURIComponent(jobId)}${cursor}`, {
        signal,
      });
    },

    cancelJob(jobId, signal) {
      return requestJob(`/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST",
        signal,
      });
    },

    getGraph(researchId, signal) {
      return requestJson(
        `/research/${encodeURIComponent(researchId)}/graph`,
        { signal },
      ) as Promise<GraphResult>;
    },

    getNodeDetails(researchId, nodeId, signal) {
      return requestJson(
        `/research/${encodeURIComponent(researchId)}/nodes/${encodeURIComponent(nodeId)}`,
        { signal },
      ) as Promise<NodeDetails>;
    },

    expandNode(researchId, input, signal) {
      return requestJob(
        `/research/${encodeURIComponent(researchId)}/expand`,
        { method: "POST", body: input, signal },
      );
    },

    askQuestion(researchId, input, signal) {
      return requestJob(
        `/research/${encodeURIComponent(researchId)}/questions`,
        { method: "POST", body: input, signal },
      );
    },

    addDiscoveries(researchId, input, signal) {
      return requestJob(
        `/research/${encodeURIComponent(researchId)}/discoveries`,
        { method: "POST", body: input, signal },
      );
    },
  };
}
