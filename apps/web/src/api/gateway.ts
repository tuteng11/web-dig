import type {
  ErrorCode,
  GraphResult,
  NodeDetails,
} from "../generated/newsTraceContracts";

export type GatewayErrorCode =
  | ErrorCode
  | "NETWORK_ERROR"
  | "MALFORMED_RESPONSE";

export class GatewayError extends Error {
  readonly code: GatewayErrorCode;
  readonly retryable: boolean;
  readonly status: number | null;
  readonly requestId: string | null;

  constructor(
    code: GatewayErrorCode,
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

export interface GatewayClient {
  getGraph(
    researchId: string,
    signal?: AbortSignal,
  ): Promise<GraphResult>;
  getNodeDetails(
    researchId: string,
    nodeId: string,
    signal?: AbortSignal,
  ): Promise<NodeDetails>;
}

interface GatewayClientOptions {
  base: string;
  fetchImpl?: typeof fetch;
}

interface ErrorEnvelopeLike {
  code: string;
  message: string;
  retryable: boolean;
  requestId: string | null;
}

const MAX_SERVER_MESSAGE_LENGTH = 600;

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
    code,
    message: toSafeServerMessage(message),
    retryable: retryable === true,
    requestId:
      typeof payload.request_id === "string" && payload.request_id.length > 0
        ? payload.request_id
        : null,
  };
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

export function createGatewayClient({
  base,
  fetchImpl,
}: GatewayClientOptions): GatewayClient {
  const normalizedBase = base.replace(/\/+$/, "") || "/api/v1";

  async function requestJson(
    path: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    let response: Response;

    try {
      const doFetch = fetchImpl ?? fetch;
      response = await doFetch(`${normalizedBase}${path}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        signal,
      });
    } catch (error) {
      if (isAbortError(error, signal)) {
        throw error;
      }
      throw new GatewayError(
        "NETWORK_ERROR",
        "Could not reach the News Trace gateway. Check that the local fixture gateway is running.",
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
          errorEnvelope.code as GatewayErrorCode,
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

  return {
    getGraph(researchId, signal) {
      return requestJson(
        `/research/${encodeURIComponent(researchId)}/graph`,
        signal,
      ) as Promise<GraphResult>;
    },
    getNodeDetails(researchId, nodeId, signal) {
      return requestJson(
        `/research/${encodeURIComponent(researchId)}/nodes/${encodeURIComponent(nodeId)}`,
        signal,
      ) as Promise<NodeDetails>;
    },
  };
}
