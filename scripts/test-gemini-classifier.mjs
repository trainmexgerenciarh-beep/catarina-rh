import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createServiceClassifier } from "../src/lib/server/gemini-service-classifier.ts";
import {
  classificationFailureDetails,
  parseServiceClassification,
  ServiceClassificationError
} from "../src/lib/server/gemini-classification-contract.ts";

const services = [
  { idServicio: "fixture-pay", categoria: "Nómina y prestaciones", subcategoria: "Premios de puntualidad y asistencia" },
  { idServicio: "fixture-rules", categoria: "Políticas y procedimientos", subcategoria: "Premios de puntualidad y asistencia" }
];
const response = (text, finishReason = "STOP") => ({
  text,
  candidates: [{ finishReason }]
});

export async function runClassifierContractChecks() {
  let checks = 0;
  function expectFailure(value, code, kind = "format") {
    assert.throws(
      () => parseServiceClassification(value, services),
      (error) =>
        error instanceof ServiceClassificationError &&
        error.code === code &&
        error.kind === kind
    );
    checks += 1;
  }

  assert.deepEqual(
    parseServiceClassification(response('{"id_servicio":"fixture-rules"}'), services),
    { serviceId: "fixture-rules", classification: "clasificado" }
  );
  assert.deepEqual(
    parseServiceClassification(response('{"id_servicio":null}'), services),
    { serviceId: null, classification: "sin clasificar" }
  );
  checks += 2;

  expectFailure(response('{"id_servicio":'), "INVALID_JSON");
  expectFailure(response('```json\n{"id_servicio":null}\n```'), "INVALID_JSON");
  expectFailure(response(""), "EMPTY_OUTPUT");
  for (const text of [
    "null", "[]", "{}", '{"id_servicio":12}',
    '{"id_servicio":true}', '{"id_servicio":{}}',
    '{"id_servicio":"fixture-pay","extra":"not allowed"}'
  ]) expectFailure(response(text), "INVALID_SCHEMA");
  expectFailure(response('{"id_servicio":"inactive-or-invented"}'), "UNKNOWN_SERVICE_ID", "catalog");
  expectFailure(response('{"id_servicio":"fixture-inactive"}'), "UNKNOWN_SERVICE_ID", "catalog");
  expectFailure(response('{"id_servicio":"fixture-pay"}', "MAX_TOKENS"), "OUTPUT_TRUNCATED");
  expectFailure(response('{"id_servicio":"fixture-pay"}', "SAFETY"), "OUTPUT_NOT_COMPLETED");
  expectFailure({ text: '{"id_servicio":null}', candidates: [{}] }, "OUTPUT_NOT_COMPLETED");
  expectFailure({ text: '{"id_servicio":null}', candidates: [] }, "INVALID_CANDIDATES");
  expectFailure({ text: '{"id_servicio":null}', candidates: [{ finishReason: "STOP" }, { finishReason: "STOP" }] }, "INVALID_CANDIDATES");
  expectFailure(null, "INVALID_CANDIDATES");
  expectFailure({ candidates: ["invalid"] }, "INVALID_CANDIDATES");
  expectFailure(response(42), "INVALID_SCHEMA");

  let request;
  const success = createServiceClassifier(async (value) => {
    request = value;
    return response('{"id_servicio":"fixture-pay"}');
  });
  assert.equal((await success("Mensaje ficticio", services)).serviceId, "fixture-pay");
  assert.equal(request.config.responseMimeType, "application/json");
  assert.equal(request.config.responseJsonSchema.additionalProperties, false);
  assert.deepEqual(request.config.responseJsonSchema.required, ["id_servicio"]);
  assert.deepEqual(
    request.config.responseJsonSchema.properties.id_servicio.anyOf,
    [{ type: "string", enum: services.map((service) => service.idServicio) }, { type: "null" }]
  );
  assert.equal(request.config.thinkingConfig.thinkingLevel, "LOW");
  assert.equal(request.config.thinkingConfig.thinkingBudget, undefined);
  assert.equal(request.config.maxOutputTokens, 1024);
  checks += 1;

  let called = false;
  const noCatalog = createServiceClassifier(async () => {
    called = true;
    return response('{"id_servicio":null}');
  });
  await assert.rejects(noCatalog("Mensaje ficticio", []), { code: "EMPTY_SERVICE_CATALOG" });
  assert.equal(called, false);
  checks += 1;

  for (const status of [401, 403, 429, 503, undefined]) {
    const providerError = Object.assign(new Error("fixture-private-provider-data"), { status });
    const fail = createServiceClassifier(async () => { throw providerError; });
    await assert.rejects(fail("Mensaje ficticio", services), (error) => {
      assert.deepEqual(classificationFailureDetails(error), {
        kind: "integration",
        code: "PROVIDER_REQUEST_FAILED",
        httpStatus: status ?? null,
        finishReason: null
      });
      assert.equal(error.cause, undefined);
      assert.equal(error.message.includes("fixture-private-provider-data"), false);
      return true;
    });
    checks += 1;
  }
  const malformed = createServiceClassifier(async () => response("not JSON"));
  await assert.rejects(malformed("Mensaje ficticio", services), {
    kind: "format", code: "INVALID_JSON"
  });
  const missingConfiguration = createServiceClassifier(async () => {
    throw new ServiceClassificationError("configuration", "MISSING_API_KEY");
  });
  await assert.rejects(missingConfiguration("Mensaje ficticio", services), {
    kind: "configuration", code: "MISSING_API_KEY"
  });
  assert.equal(classificationFailureDetails(new Error("fixture-private-data")), null);
  checks += 3;
  console.log(`Contrato Gemini local: PASS (${checks} comprobaciones; sin Neon, API ni Secrets).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runClassifierContractChecks();
}
