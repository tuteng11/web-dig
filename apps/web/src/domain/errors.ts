import { GatewayError } from "../api/gateway";

export interface UiError {
  code: string;
  message: string;
  retryable: boolean;
  requestId: string | null;
  details: string[];
}

function safeDetails(details: string[]): string[] {
  return details.slice(0, 8);
}

export function toUiError(
  error: unknown,
  fallbackMessage: string,
): UiError {
  if (error instanceof GatewayError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      requestId: error.requestId,
      details: [],
    };
  }

  return {
    code: "UNEXPECTED_ERROR",
    message: fallbackMessage,
    retryable: true,
    requestId: null,
    details: [],
  };
}

export function malformedGraphError(errors: string[]): UiError {
  return {
    code: "MALFORMED_RESPONSE",
    message:
      "The gateway graph response failed runtime validation, so no graph was displayed.",
    retryable: false,
    requestId: null,
    details: safeDetails(errors),
  };
}

export function malformedNodeDetailsError(errors: string[]): UiError {
  return {
    code: "MALFORMED_RESPONSE",
    message:
      "The node details response failed runtime validation, so the details were not displayed.",
    retryable: false,
    requestId: null,
    details: safeDetails(errors),
  };
}
