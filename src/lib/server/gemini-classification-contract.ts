import type { ActiveService } from "./neon-collaborators";

export type ServiceClassification = {
  serviceId: string | null;
  classification: "clasificado" | "sin clasificar";
};

type FailureKind = "configuration" | "integration" | "format" | "catalog";
type FailureCode =
  | "MISSING_API_KEY"
  | "PROVIDER_REQUEST_FAILED"
  | "EMPTY_SERVICE_CATALOG"
  | "OUTPUT_TRUNCATED"
  | "OUTPUT_NOT_COMPLETED"
  | "INVALID_CANDIDATES"
  | "EMPTY_OUTPUT"
  | "INVALID_JSON"
  | "INVALID_SCHEMA"
  | "UNKNOWN_SERVICE_ID";

/** Deliberately excludes provider messages, causes, output, input, and IDs. */
export class ServiceClassificationError extends Error {
  readonly kind: FailureKind;
  readonly code: FailureCode;
  readonly httpStatus: number | null;
  readonly finishReason: string | null;

  constructor(
    kind: FailureKind,
    code: FailureCode,
    httpStatus: number | null = null,
    finishReason: string | null = null
  ) {
    super(`Gemini classification failed: ${code}`);
    this.name = "ServiceClassificationError";
    this.kind = kind;
    this.code = code;
    this.httpStatus = httpStatus;
    this.finishReason = finishReason;
  }
}

export function classificationFailureDetails(error: unknown) {
  if (!(error instanceof ServiceClassificationError)) return null;
  return {
    kind: error.kind,
    code: error.code,
    httpStatus: error.httpStatus,
    finishReason: error.finishReason
  };
}

export function integrationFailure(error: unknown): ServiceClassificationError {
  if (error instanceof ServiceClassificationError) return error;
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number" &&
    Number.isInteger(error.status) &&
    error.status >= 100 &&
    error.status <= 599
      ? error.status
      : null;
  return new ServiceClassificationError(
    "integration",
    "PROVIDER_REQUEST_FAILED",
    status
  );
}

export function selectActiveServiceById(
  candidateId: unknown,
  services: ActiveService[]
): ServiceClassification {
  if (services.length === 0) {
    throw new ServiceClassificationError("catalog", "EMPTY_SERVICE_CATALOG");
  }
  if (candidateId === null) {
    return { serviceId: null, classification: "sin clasificar" };
  }
  if (typeof candidateId !== "string") {
    throw new ServiceClassificationError("format", "INVALID_SCHEMA");
  }
  const service = services.find(({ idServicio }) => idServicio === candidateId);
  if (!service) {
    throw new ServiceClassificationError("catalog", "UNKNOWN_SERVICE_ID");
  }
  return { serviceId: service.idServicio, classification: "clasificado" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reject incomplete generations before parsing; never repair or salvage JSON. */
export function parseServiceClassification(
  response: unknown,
  services: ActiveService[]
): ServiceClassification {
  if (
    !isRecord(response) ||
    !Array.isArray(response.candidates) ||
    response.candidates.length !== 1 ||
    !isRecord(response.candidates[0])
  ) {
    throw new ServiceClassificationError("format", "INVALID_CANDIDATES");
  }
  const finishReason = response.candidates[0].finishReason;
  if (finishReason === "MAX_TOKENS") {
    throw new ServiceClassificationError(
      "format", "OUTPUT_TRUNCATED", null, "MAX_TOKENS"
    );
  }
  if (finishReason !== "STOP") {
    // Do not include arbitrary provider text in the safe diagnostic fields.
    throw new ServiceClassificationError("format", "OUTPUT_NOT_COMPLETED");
  }
  const output = response.text;
  if (output === undefined || output === null || output === "") {
    throw new ServiceClassificationError("format", "EMPTY_OUTPUT");
  }
  if (typeof output !== "string") {
    throw new ServiceClassificationError("format", "INVALID_SCHEMA");
  }
  const text = output.trim();
  if (!text) throw new ServiceClassificationError("format", "EMPTY_OUTPUT");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ServiceClassificationError("format", "INVALID_JSON");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(parsed, "id_servicio") ||
    !("id_servicio" in parsed)
  ) {
    throw new ServiceClassificationError("format", "INVALID_SCHEMA");
  }
  return selectActiveServiceById(parsed.id_servicio, services);
}
