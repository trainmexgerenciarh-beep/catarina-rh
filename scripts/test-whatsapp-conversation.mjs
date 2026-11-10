import assert from "node:assert/strict";
import {
  createConversationManager,
  processIncomingConversationEvent,
  summarizeConversationResults
} from "../src/lib/server/whatsapp-conversation.js";

const activePhone = "15550000001";
const directIdeaPhone = "15550000004";
const directPayrollPhone = "15550000005";
const deniedPhone = "15550000002";
const inactivePhone = "15550000003";
const ambiguousPhone = "15550000006";
const sampleServices = [
  {
    idServicio: "fixture-weekly-pay",
    categoria: "Nómina y prestaciones",
    subcategoria: "Pago semanal"
  },
  {
    idServicio: "fixture-vacations",
    categoria: "Políticas y procedimientos",
    subcategoria: "Vacaciones"
  },
  {
    idServicio: "fixture-complaints",
    categoria: "Tu Voz en Trainmex",
    subcategoria: "Quejas y denuncias"
  },
  {
    idServicio: "fixture-ideas",
    categoria: "Tu Voz en Trainmex",
    subcategoria: "Ideas y mejoras"
  }
];

function makeDependencies() {
  const classificationCalls = [];
  const catalogReads = [];
  const dependencies = {
    lookupCollaborator: async (phone) => {
      if (
        phone === activePhone ||
        phone === directIdeaPhone ||
        phone === directPayrollPhone
      ) {
        return "active";
      }
      if (phone === inactivePhone) return "inactive";
      if (phone === ambiguousPhone) return "ambiguous";
      return "not_found";
    },
    listActiveServices: async () => {
      catalogReads.push(sampleServices);
      return sampleServices;
    },
    classifyService: async (text, services) => {
      classificationCalls.push({ text, services });
      const normalized = text
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLocaleLowerCase("es");
      const match = normalized.includes("vacacion")
        ? sampleServices[1]
        : normalized.includes("queja") || normalized.includes("denuncia")
          ? sampleServices[2]
          : normalized.includes("idea") || normalized.includes("mejora")
            ? sampleServices[3]
            : normalized.includes("pago semanal")
              ? sampleServices[0]
              : null;
      assert.strictEqual(services, sampleServices);
      return match
        ? { serviceId: match.idServicio, classification: "clasificado" }
        : { serviceId: null, classification: "sin clasificar" };
    }
  };
  return { dependencies, classificationCalls, catalogReads };
}

function makeEvent(from, text) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              messages: [{ from, type: "text", text: { body: text } }]
            }
          }
        ]
      }
    ]
  };
}

async function testAuthorizationAndWelcome() {
  const { dependencies, classificationCalls } = makeDependencies();
  const sessions = new Map();
  const manager = createConversationManager(dependencies, sessions);

  const missing = await manager.handleMessage(deniedPhone, "Hola");
  assert.equal(missing.collaboratorStatus, "not_found");
  assert.equal(missing.action, "access_denied");
  assert.equal(sessions.has(deniedPhone), false);

  const inactive = await manager.handleMessage(inactivePhone, "Hola");
  assert.equal(inactive.collaboratorStatus, "inactive");
  assert.equal(inactive.action, "access_denied");
  assert.equal(sessions.has(inactivePhone), false);
  const ambiguous = await manager.handleMessage(ambiguousPhone, "Hola");
  assert.equal(ambiguous.collaboratorStatus, "ambiguous");
  assert.equal(ambiguous.action, "access_denied");
  assert.equal(sessions.has(ambiguousPhone), false);
  assert.equal(classificationCalls.length, 0);

  const welcome = await manager.handleMessage(activePhone, "Hola");
  assert.equal(welcome.action, "welcome");
  assert.match(welcome.reply, /Hola, soy Catarina/);
  assert.match(welcome.reply, /1\. Nómina y prestaciones/);
  assert.match(welcome.reply, /2\. Políticas y procedimientos de RH/);
  assert.match(welcome.reply, /3\. Tu Voz en Trainmex/);
  console.log("Acceso activo/denegado y bienvenida con tres opciones: PASS.");
}

async function testMenuContextCommandsAndCorrection() {
  const { dependencies } = makeDependencies();
  const sessions = new Map();
  const manager = createConversationManager(dependencies, sessions);

  await manager.handleMessage(activePhone, "Hola");
  const payroll = await manager.handleMessage(activePhone, "1");
  assert.equal(payroll.action, "category_selected");
  assert.match(payroll.reply, /Nómina y prestaciones/);
  assert.match(payroll.reply, /pago semanal, despensa, gasolina/);

  const narrative = "Me falta el pago semanal del viernes.";
  const firstDetail = await manager.handleMessage(activePhone, narrative);
  assert.equal(firstDetail.action, "need_received");
  assert.match(firstDetail.reply, /no guarda mensajes/i);
  assert.equal(firstDetail.classification, "clasificado");
  assert.equal(JSON.stringify(sessions.get(activePhone)).includes(narrative), false);

  const followup = await manager.handleMessage(
    activePhone,
    "También quiero indicar que fue el depósito más reciente."
  );
  assert.equal(followup.action, "need_received");
  assert.doesNotMatch(followup.reply, /Hola, soy Catarina/);
  assert.doesNotMatch(followup.reply, /Cuéntame brevemente qué necesitas/);

  const correction = await manager.handleMessage(activePhone, "Me equivoqué");
  assert.equal(correction.action, "correction");
  const unclearCorrection = await manager.handleMessage(
    activePhone,
    "Es sobre algo diferente."
  );
  assert.equal(unclearCorrection.action, "correction_applied");
  assert.match(unclearCorrection.reply, /¿Se trata de/);
  const changedCategory = await manager.handleMessage(activePhone, "2");
  assert.equal(changedCategory.action, "category_changed");
  assert.match(changedCategory.reply, /Políticas y procedimientos de RH/);
  assert.match(changedCategory.reply, /vacaciones, permisos, premios/);

  const menu = await manager.handleMessage(activePhone, "menú principal");
  assert.equal(menu.action, "menu");
  assert.match(menu.reply, /1\. Nómina y prestaciones/);
  const back = await manager.handleMessage(activePhone, "regresar");
  assert.equal(back.action, "back");
  assert.doesNotMatch(back.reply, /Hola, soy Catarina/);
  const cancel = await manager.handleMessage(activePhone, "cancelar");
  assert.equal(cancel.action, "cancelled");
  assert.equal(sessions.has(activePhone), false);
  console.log("Selección numérica, continuidad, corrección, menú, regresar y cancelar: PASS.");
}

async function testNaturalEntryAndVoiceSubmenu() {
  const { dependencies } = makeDependencies();
  const manager = createConversationManager(dependencies);

  const directPolicy = await manager.handleMessage(
    activePhone,
    "Necesito saber cuántos días de vacaciones tengo."
  );
  assert.equal(directPolicy.action, "direct_entry");
  assert.match(directPolicy.reply, /Políticas y procedimientos de RH/);
  assert.match(directPolicy.reply, /no hace falta que repitas/);
  assert.doesNotMatch(directPolicy.reply, /fixture-vacations/);

  const directPayroll = await manager.handleMessage(
    directPayrollPhone,
    "Me falta el pago semanal."
  );
  assert.equal(directPayroll.action, "direct_entry");
  assert.match(directPayroll.reply, /Nómina y prestaciones/);

  const voiceMenu = await manager.handleMessage(activePhone, "menú principal");
  assert.equal(voiceMenu.action, "menu");
  const voiceCategory = await manager.handleMessage(activePhone, "3");
  assert.equal(voiceCategory.action, "category_selected");
  assert.match(voiceCategory.reply, /1\. Quejas y denuncias/);
  assert.match(voiceCategory.reply, /2\. Ideas y mejoras/);

  const complaint = await manager.handleMessage(activePhone, "1");
  assert.equal(complaint.action, "voice_topic_selected");
  assert.match(complaint.reply, /Quejas y denuncias/);
  assert.match(complaint.reply, /no se registra ningún expediente/);

  const backToVoice = await manager.handleMessage(activePhone, "regresar");
  assert.equal(backToVoice.action, "back");
  assert.match(backToVoice.reply, /1\. Quejas y denuncias/);
  const ideas = await manager.handleMessage(activePhone, "2");
  assert.equal(ideas.action, "voice_topic_selected");
  assert.match(ideas.reply, /Ideas y mejoras/);

  const directIdea = await manager.handleMessage(
    directIdeaPhone,
    "Tengo una idea para mejorar un proceso."
  );
  assert.equal(directIdea.action, "direct_entry");
  assert.match(directIdea.reply, /ideas y mejoras/i);
  console.log("Entrada natural y submenú de Tu Voz con regreso: PASS.");
}

async function testAmbiguityAndPayloadProcessing() {
  const { dependencies, classificationCalls, catalogReads } = makeDependencies();
  const manager = createConversationManager(dependencies);
  const results = await processIncomingConversationEvent(
    makeEvent(activePhone, "Necesito ayuda con un tema que no sé cómo nombrar."),
    manager
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].action, "clarify_category");
  assert.match(results[0].reply, /Nómina y prestaciones/);
  assert.match(results[0].reply, /Políticas y procedimientos de RH/);
  assert.match(results[0].reply, /Tu Voz en Trainmex/);
  assert.equal(classificationCalls.length, 1);
  assert.equal(catalogReads.length, 1);
  assert.deepEqual(summarizeConversationResults(results), {
    textMessages: 1,
    active: 1,
    denied: 0,
    classified: 0,
    unclassified: 1
  });

  const naturalVoice = await manager.handleMessage(
    activePhone,
    "Quiero presentar una queja."
  );
  assert.equal(naturalVoice.action, "direct_entry");
  assert.match(naturalVoice.reply, /quejas y denuncias/i);

  const inventedIdManager = createConversationManager({
    lookupCollaborator: async () => "active",
    listActiveServices: async () => sampleServices,
    classifyService: async () => ({
      serviceId: "invented-service-id",
      classification: "clasificado"
    })
  });
  const invalidClassification = await inventedIdManager.handleMessage(
    directPayrollPhone,
    "Necesito orientación sobre un tema."
  );
  assert.equal(invalidClassification.action, "clarify_category");
  assert.equal(invalidClassification.classification, "sin clasificar");
  console.log("Mensaje ambiguo y entrada directa a Tu Voz: PASS.");
  console.log("La validación rechaza IDs de servicio ajenos al catálogo: PASS.");
}

await testAuthorizationAndWelcome();
await testMenuContextCommandsAndCorrection();
await testNaturalEntryAndVoiceSubmenu();
await testAmbiguityAndPayloadProcessing();
console.log(
  "Simulación conversacional ficticia terminada; no hubo envíos, persistencia de relatos ni registros operativos."
);
