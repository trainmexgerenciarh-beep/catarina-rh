import assert from "node:assert/strict";
import {
  extractIncomingTextMessages,
  processIncomingMessages,
  summarizeProcessingResults
} from "../src/lib/server/whatsapp-message-processing.js";
import {
  closeNeonPool,
  listActiveServices,
  lookupCollaboratorStatus
} from "../src/lib/server/neon-collaborators.ts";
import { classifyService } from "../src/lib/server/gemini-service-classifier.ts";

const syntheticPhone = "000000000000000";
const syntheticServices = [
  {
    idServicio: "synthetic-payroll",
    categoria: "Nómina",
    subcategoria: "Pagos y recibos"
  },
  {
    idServicio: "synthetic-benefits",
    categoria: "Prestaciones",
    subcategoria: "Beneficios y seguros"
  },
  {
    idServicio: "synthetic-personnel-policy",
    categoria: "Políticas de personal",
    subcategoria: "Vacaciones y permisos"
  }
];
const syntheticText = "Consulta ficticia sobre una constancia de empleo.";

function makeEvent(
  messages = [{ from: syntheticPhone, type: "text", text: { body: syntheticText } }]
) {
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
  let serviceCatalogReads = 0;
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
    listActiveServices: async () => {
      serviceCatalogReads += 1;
      return syntheticServices;
    },
    classifyService: async (text, services) => {
      classifications.push(text);
      return {
        serviceId: services[0].idServicio,
        classification: "clasificado"
      };
    }
  });

  assert.deepEqual(results.map((result) => result.collaboratorStatus), statuses);
  assert.deepEqual(
    results.map((result) => result.serviceId),
    statuses.map(() => syntheticServices[0].idServicio)
  );
  assert.equal(serviceCatalogReads, 1);
  assert.equal(classifications.length, statuses.length);
  assert.equal(lookups.length, statuses.length);
  assert.deepEqual(summarizeProcessingResults(results), {
    textMessages: 4,
    active: 1,
    inactive: 1,
    notFound: 1,
    ambiguous: 1,
    classified: 4,
    unclassified: 0
  });

  const noMatch = await processIncomingMessages(makeEvent(), {
    lookupCollaborator: async () => "not_found",
    listActiveServices: async () => syntheticServices,
    classifyService: async () => ({
      serviceId: null,
      classification: "sin clasificar"
    })
  });
  assert.deepEqual(noMatch[0], {
    collaboratorStatus: "not_found",
    serviceId: null,
    classification: "sin clasificar"
  });

  const noServices = await processIncomingMessages(makeEvent(), {
    lookupCollaborator: async () => "active",
    listActiveServices: async () => [],
    classifyService
  });
  assert.deepEqual(noServices[0], {
    collaboratorStatus: "active",
    serviceId: null,
    classification: "sin clasificar"
  });

  console.log("Procesamiento y extracción de eventos ficticios: PASS.");
  console.log("Estados activo, inactivo, no encontrado y ambiguo: PASS.");
  console.log("Sin coincidencia y sin catálogo: resultado «sin clasificar»: PASS.");
}

async function runNeonReadOnlyCheck() {
  const status = await lookupCollaboratorStatus(syntheticPhone);
  assert.equal(status, "not_found");
  console.log("Consulta parametrizada de solo lectura en Neon con remitente ficticio: PASS.");

  const services = await listActiveServices();
  assert.ok(
    services.every(
      (service) =>
        typeof service.idServicio === "string" &&
        (typeof service.categoria === "string" || service.categoria === null) &&
        (typeof service.subcategoria === "string" ||
          service.subcategoria === null)
    )
  );
  console.log(
    `Consulta de solo lectura a servicios activos en Neon: PASS (${services.length} opciones; nombres e IDs omitidos).`
  );
}

async function runGeminiCheck() {
  const cases = [
    {
      text: "Consulta ficticia: no aparece el pago de horas extra en mi recibo de nómina.",
      expectedId: syntheticServices[0].idServicio,
      label: "nómina"
    },
    {
      text: "Consulta ficticia: ¿qué beneficios y seguro médico incluyen mis prestaciones?",
      expectedId: syntheticServices[1].idServicio,
      label: "prestaciones"
    },
    {
      text: "Consulta ficticia: ¿cuál es la política de personal para solicitar vacaciones?",
      expectedId: syntheticServices[2].idServicio,
      label: "políticas de personal"
    }
  ];

  for (const testCase of cases) {
    const result = await processIncomingMessages(makeEvent([
      { from: syntheticPhone, type: "text", text: { body: testCase.text } }
    ]), {
      lookupCollaborator: async () => "active",
      listActiveServices: async () => syntheticServices,
      classifyService
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].classification, "clasificado", testCase.label);
    assert.equal(result[0].serviceId, testCase.expectedId, testCase.label);
    console.log(`Gemini mapea mensaje ficticio de ${testCase.label}: PASS.`);
  }

  const unmatched = await classifyService(
    "Consulta ficticia ajena a Recursos Humanos sobre el pronóstico del clima.",
    syntheticServices
  );
  assert.deepEqual(unmatched, {
    serviceId: null,
    classification: "sin clasificar"
  });
  console.log("Gemini devuelve «sin clasificar» si ninguna opción corresponde: PASS.");
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
