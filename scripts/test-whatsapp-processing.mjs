import assert from "node:assert/strict";
import {
  extractIncomingTextMessages,
  processIncomingMessages,
  summarizeProcessingResults
} from "../src/lib/server/whatsapp-message-processing.js";
import { closeNeonPool, lookupCollaboratorStatus } from "../src/lib/server/neon-collaborators.ts";
import { classifyTopic } from "../src/lib/server/gemini-topic-classifier.ts";

const syntheticPhone = "000000000000000";
const syntheticText = "Consulta ficticia: ¿cómo solicito una constancia de empleo?";

function makeEvent(messages = [{ from: syntheticPhone, type: "text", text: { body: syntheticText } }]) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: { messages }
          }
        ]
      }
    ]
  };
}

async function runUnitChecks() {
  const extracted = extractIncomingTextMessages(makeEvent());
  assert.deepEqual(extracted, [{ senderPhone: syntheticPhone, text: syntheticText }]);

  assert.deepEqual(
    extractIncomingTextMessages({ ...makeEvent(), object: "other" }),
    []
  );
  assert.deepEqual(
    extractIncomingTextMessages({
      ...makeEvent(),
      entry: [{ changes: [{ field: "statuses", value: { messages: [] } }] }]
    }),
    []
  );
  assert.deepEqual(
    extractIncomingTextMessages(
      makeEvent([{ from: syntheticPhone, type: "image", image: { id: "fake" } }])
    ),
    []
  );
  assert.deepEqual(extractIncomingTextMessages({ entry: "malformed" }), []);

  const statuses = ["active", "inactive", "not_found", "ambiguous"];
  const lookups = [];
  const classifications = [];
  const batch = makeEvent(statuses.map((_, index) => ({
    from: `${syntheticPhone}${index}`,
    type: "text",
    text: { body: `Mensaje ficticio ${index}` }
  })));
  const results = await processIncomingMessages(batch, {
    lookupCollaborator: async (phone) => {
      lookups.push(phone);
      return statuses[lookups.length - 1];
    },
    classifyTopic: async (text) => {
      classifications.push(text);
      return "tema ficticio";
    }
  });

  assert.deepEqual(results.map((result) => result.collaboratorStatus), statuses);
  assert.equal(classifications.length, statuses.length);
  assert.equal(lookups.length, statuses.length);
  assert.deepEqual(summarizeProcessingResults(results), {
    textMessages: 4,
    active: 1,
    inactive: 1,
    notFound: 1,
    ambiguous: 1,
    classified: 4
  });

  console.log("Procesamiento y extracción de eventos ficticios: PASS.");
  console.log("Estados activo, inactivo, no encontrado y ambiguo: PASS.");
}

async function runNeonReadOnlyCheck() {
  const status = await lookupCollaboratorStatus(syntheticPhone);
  assert.equal(status, "not_found");
  console.log("Consulta parametrizada de solo lectura en Neon con remitente ficticio: PASS.");
}

async function runGeminiCheck() {
  const result = await processIncomingMessages(makeEvent(), {
    lookupCollaborator: async () => "active",
    classifyTopic
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].collaboratorStatus, "active");
  assert.ok(result[0].topic.length > 0);
  console.log("Clasificación Gemini mediante @google/genai con texto ficticio: PASS.");
}

try {
  await runUnitChecks();
  await runNeonReadOnlyCheck();
  await runGeminiCheck();
  console.log("Prueba interna de procesamiento completada; no se guardaron mensajes ni se enviaron respuestas.");
} catch {
  console.error(
    "Prueba de procesamiento fallida; revisa la conectividad de Neon/Gemini y los Secrets requeridos."
  );
  process.exitCode = 1;
} finally {
  await closeNeonPool().catch(() => {});
}
