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
import {
  classifyService,
  selectActiveServiceById
} from "../src/lib/server/gemini-service-classifier.ts";

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

  assert.deepEqual(
    selectActiveServiceById(syntheticServices[0].idServicio, syntheticServices),
    {
      serviceId: syntheticServices[0].idServicio,
      classification: "clasificado"
    }
  );
  assert.deepEqual(selectActiveServiceById("invented-id", syntheticServices), {
    serviceId: null,
    classification: "sin clasificar"
  });
  assert.deepEqual(selectActiveServiceById(1, syntheticServices), {
    serviceId: null,
    classification: "sin clasificar"
  });

  console.log("Procesamiento y extracción de eventos ficticios: PASS.");
  console.log("Estados activo, inactivo, no encontrado y ambiguo: PASS.");
  console.log("ID ajeno al catálogo y sin catálogo: resultado «sin clasificar»: PASS.");
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
  assert.equal(services.length, 15);
  const countsByCategory = services.reduce((counts, service) => {
    const category = service.categoria ?? "";
    counts[category] = (counts[category] ?? 0) + 1;
    return counts;
  }, {});
  assert.deepEqual(countsByCategory, {
    "Nómina y prestaciones": 8,
    "Políticas y procedimientos": 5,
    "Tu Voz en Trainmex": 2
  });
  assert.equal(new Set(services.map((service) => service.idServicio)).size, 15);
  console.log(
    "Catálogo activo real de Neon: PASS (15 servicios en la distribución esperada; nombres e IDs omitidos)."
  );
  return services;
}

async function runGeminiCheck(services) {
  const cases = [
    {
      text: "Consulta ficticia: ¿qué día depositan el pago semanal?",
      category: "Nómina y prestaciones",
      subcategory: "Pago semanal",
      label: "pago semanal"
    },
    {
      text: "Consulta ficticia: no recibí el apoyo de despensa de esta semana.",
      category: "Nómina y prestaciones",
      subcategory: "Despensa",
      label: "despensa"
    },
    {
      text: "Consulta ficticia: no se reflejó el apoyo de gasolina en mi pago.",
      category: "Nómina y prestaciones",
      subcategory: "Gasolina",
      label: "gasolina"
    },
    {
      text: "Consulta ficticia: ¿cuántos días de vacaciones puedo solicitar?",
      category: "Políticas y procedimientos",
      subcategory: "Vacaciones",
      label: "vacaciones"
    },
    {
      text: "Consulta ficticia: ¿cómo solicito un permiso personal?",
      category: "Políticas y procedimientos",
      subcategory: "Permisos",
      label: "permisos"
    },
    {
      text: "Consulta ficticia: me faltan horas extra en el recibo de esta semana.",
      category: "Nómina y prestaciones",
      subcategory: "Horas extra",
      label: "horas extra"
    },
    {
      text: "Consulta ficticia: no aparece en mi depósito el premio de puntualidad y asistencia.",
      category: "Nómina y prestaciones",
      subcategory: "Premios de puntualidad y asistencia",
      label: "pago de premios"
    },
    {
      text: "Consulta ficticia: ¿qué requisitos debo cumplir para obtener el premio de puntualidad y asistencia?",
      category: "Políticas y procedimientos",
      subcategory: "Premios de puntualidad y asistencia",
      label: "reglas de premios"
    },
    {
      text: "Consulta ficticia: quiero presentar una queja sobre una situación de trabajo.",
      category: "Tu Voz en Trainmex",
      subcategory: "Quejas y denuncias",
      label: "quejas"
    },
    {
      text: "Consulta ficticia: tengo una idea para mejorar un proceso de la empresa.",
      category: "Tu Voz en Trainmex",
      subcategory: "Ideas y mejoras",
      label: "ideas de mejora"
    }
  ];

  for (const testCase of cases) {
    const expectedService = services.find(
      (service) =>
        service.categoria === testCase.category &&
        service.subcategoria === testCase.subcategory
    );
    assert.ok(expectedService, `Expected active service missing: ${testCase.label}`);

    const result = await processIncomingMessages(makeEvent([
      { from: syntheticPhone, type: "text", text: { body: testCase.text } }
    ]), {
      lookupCollaborator: async () => "active",
      listActiveServices: async () => services,
      classifyService
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].classification, "clasificado", testCase.label);
    assert.equal(result[0].serviceId, expectedService.idServicio, testCase.label);
    assert.ok(
      services.some((service) => service.idServicio === result[0].serviceId),
      `Gemini returned an ID outside the active catalog: ${testCase.label}`
    );
    console.log(`Gemini clasifica contra el catálogo real: ${testCase.label}: PASS.`);
  }

  const unmatched = await classifyService(
    "Consulta ficticia ajena a Recursos Humanos sobre el pronóstico del clima.",
    services
  );
  assert.deepEqual(unmatched, {
    serviceId: null,
    classification: "sin clasificar"
  });
  console.log("Gemini devuelve «sin clasificar» si ninguna opción corresponde: PASS.");
}

try {
  await runUnitChecks();
  const activeServices = await runNeonReadOnlyCheck();
  await runGeminiCheck(activeServices);
  console.log("Prueba interna de procesamiento completada; no se guardaron mensajes ni se enviaron respuestas.");
} catch {
  console.error(
    "Prueba de procesamiento fallida; revisa la conectividad de Neon/Gemini y los Secrets requeridos."
  );
  process.exitCode = 1;
} finally {
  await closeNeonPool().catch(() => {});
}
