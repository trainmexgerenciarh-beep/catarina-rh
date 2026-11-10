import { extractIncomingTextMessages } from "./whatsapp-message-processing.js";

/**
 * @typedef {"payroll" | "policies" | "voice"} CategoryKey
 * @typedef {"complaints" | "ideas"} VoiceTopic
 * @typedef {"main_menu" | "category" | "voice_submenu"} ConversationScreen
 * @typedef {"active" | "inactive" | "not_found" | "ambiguous"} CollaboratorStatus
 * @typedef {{
 *   idServicio: string;
 *   categoria: string | null;
 *   subcategoria: string | null;
 * }} ActiveService
 * @typedef {{
 *   serviceId: string | null;
 *   classification: "clasificado" | "sin clasificar";
 * }} ServiceClassification
 * @typedef {{
 *   category: CategoryKey;
 *   voiceTopic: VoiceTopic | null;
 * }} ConversationIntent
 * @typedef {{
 *   intent: ConversationIntent | null;
 *   classification: "clasificado" | "sin clasificar" | null;
 * }} IntentClassification
 * @typedef {{
 *   screen: ConversationScreen;
 *   category: CategoryKey | null;
 *   voiceTopic: VoiceTopic | null;
 *   hasExplainedNeed: boolean;
 *   awaitingCorrection: boolean;
 * }} ConversationState
 * @typedef {{
 *   collaboratorStatus: CollaboratorStatus;
 *   action: string;
 *   reply: string;
 *   classification: "clasificado" | "sin clasificar" | null;
 * }} ConversationResult
 * @typedef {{
 *   lookupCollaborator: (phone: string) => Promise<CollaboratorStatus>;
 *   listActiveServices: () => Promise<ActiveService[]>;
 *   classifyService: (
 *     text: string,
 *     services: ActiveService[]
 *   ) => Promise<ServiceClassification>;
 * }} ConversationDependencies
 */

/** @type {Array<{key: CategoryKey; label: string}>} */
const CATEGORY_OPTIONS = [
  { key: "payroll", label: "Nómina y prestaciones" },
  { key: "policies", label: "Políticas y procedimientos de RH" },
  { key: "voice", label: "Tu Voz en Trainmex" }
];

const CATEGORY_DETAILS = {
  payroll: {
    label: "Nómina y prestaciones",
    examples:
      "Puedes contarme sobre pago semanal, despensa, gasolina, recibo de nómina, premios, horas extra o descuentos."
  },
  policies: {
    label: "Políticas y procedimientos de RH",
    examples:
      "Puedes contarme sobre vacaciones, permisos, premios, adelantos de nómina o políticas de RH."
  }
};

/** @type {Array<{key: VoiceTopic; label: string}>} */
const VOICE_OPTIONS = [
  { key: "complaints", label: "Quejas y denuncias" },
  { key: "ideas", label: "Ideas y mejoras" }
];

const VOICE_DETAILS = {
  complaints: {
    label: "Quejas y denuncias",
    examples: "Puedes explicar brevemente una queja o una situación que quieras comunicar."
  },
  ideas: {
    label: "Ideas y mejoras",
    examples: "Puedes compartir una idea para mejorar un proceso o una forma de trabajo."
  }
};

const EMPTY_CLASSIFICATION = "sin clasificar";

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeInput(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * @param {string} input
 * @param {number} max
 * @returns {number | null}
 */
function parseOptionNumber(input, max) {
  const match = input.match(/^(?:opcion\s*)?([1-3])(?:[).:\s-].*)?$/u);
  if (!match) return null;
  const option = Number(match[1]);
  return option <= max ? option : null;
}

/**
 * @param {string} input
 * @returns {CategoryKey | null}
 */
function explicitCategoryChoice(input) {
  if (/^(?:nomina|nomina y prestaciones)$/u.test(input)) return "payroll";
  if (
    /^(?:politicas|politicas de rh|politicas y procedimientos(?: de rh)?)$/u.test(
      input
    )
  ) {
    return "policies";
  }
  if (/^(?:tu voz|tu voz en trainmex)$/u.test(input)) return "voice";
  return null;
}

/**
 * @param {string} input
 * @returns {"cancel" | "menu" | "back" | "correct" | null}
 */
function commandFor(input) {
  if (/^(?:cancelar|cancela|salir)$/u.test(input)) return "cancel";
  if (/^(?:menu principal|menu|inicio)$/u.test(input)) return "menu";
  if (/^(?:regresar|volver|atras|anterior)$/u.test(input)) return "back";
  if (
    /^(?:corrijo|correccion|me equivoque|no era|quise decir|quiero corregir|cambiar de categoria|cambiar de tema)\b/u.test(
      input
    )
  ) {
    return "correct";
  }
  return null;
}

/**
 * @param {string} input
 * @returns {boolean}
 */
function isGreeting(input) {
  return /^(?:hola|buenos dias|buenas tardes|buenas noches|buen dia|ayuda|iniciar)$/u.test(
    input
  );
}

/**
 * @param {CollaboratorStatus} collaboratorStatus
 * @param {string} action
 * @param {string} reply
 * @param {"clasificado" | "sin clasificar" | null} [classification=null]
 * @returns {ConversationResult}
 */
function makeResult(collaboratorStatus, action, reply, classification = null) {
  return { collaboratorStatus, action, reply, classification };
}

/**
 * @param {ConversationState} state
 * @param {boolean} includeWelcome
 * @returns {string}
 */
function showMainMenu(state, includeWelcome) {
  state.screen = "main_menu";
  state.category = null;
  state.voiceTopic = null;
  state.hasExplainedNeed = false;
  state.awaitingCorrection = false;
  const welcome = includeWelcome
    ? "Hola, soy Catarina, recepcionista virtual de RH. Puedo ayudarte a ubicar tu necesidad."
    : "Menú principal:";
  return `${welcome}\n\nElige una opción por número o cuéntame directamente qué necesitas:\n1. Nómina y prestaciones (pagos semanales, despensa, gasolina y conceptos similares).\n2. Políticas y procedimientos de RH (vacaciones, permisos, premios, etc.).\n3. Tu Voz en Trainmex (quejas y denuncias o ideas y mejoras).\n\nEn esta etapa solo simulamos la recepción: no resuelvo asuntos ni registro trámites.`;
}

function voiceSubmenuText() {
  return `Tu Voz en Trainmex:\n1. Quejas y denuncias (una situación del entorno laboral que quieras comunicar).\n2. Ideas y mejoras (una propuesta para cambiar o mejorar un proceso).\n\nElige una opción o cuéntame brevemente de qué se trata. En esta etapa no se registran expedientes.`;
}

/**
 * @param {ConversationState} state
 * @param {CategoryKey} category
 * @param {boolean} alreadyExplained
 * @param {string} [prefix]
 * @returns {string}
 */
function enterCategory(state, category, alreadyExplained, prefix = "") {
  state.category = category;
  state.awaitingCorrection = false;

  if (category === "voice") {
    state.screen = "voice_submenu";
    state.voiceTopic = null;
    state.hasExplainedNeed = false;
    return `${prefix}${voiceSubmenuText()}`;
  }

  const detail = CATEGORY_DETAILS[category];
  state.screen = "category";
  state.voiceTopic = null;
  state.hasExplainedNeed = alreadyExplained;

  if (alreadyExplained) {
    return `${prefix}Entiendo que tu necesidad corresponde a ${detail.label}. Ya la tengo ubicada; no hace falta que repitas el menú. Puedes agregar un dato, corregir, regresar, pedir el menú principal o cancelar. En esta simulación no se crea un ticket ni una cita.`;
  }

  return `${prefix}${detail.label}. ${detail.examples}\n\nCuéntame brevemente qué necesitas. Esta simulación no resuelve nómina ni crea tickets o citas.`;
}

/**
 * @param {ConversationState} state
 * @param {VoiceTopic} voiceTopic
 * @param {boolean} alreadyExplained
 * @param {string} [prefix]
 * @returns {string}
 */
function enterVoiceTopic(state, voiceTopic, alreadyExplained, prefix = "") {
  const detail = VOICE_DETAILS[voiceTopic];
  state.screen = "category";
  state.category = "voice";
  state.voiceTopic = voiceTopic;
  state.hasExplainedNeed = alreadyExplained;
  state.awaitingCorrection = false;

  if (alreadyExplained) {
    return `${prefix}Entiendo que quieres compartir ${detail.label.toLocaleLowerCase("es")}. No hace falta que repitas lo que ya explicaste. Esta simulación no registra expedientes ni conserva el relato. Puedes agregar un dato, corregir, regresar o cancelar.`;
  }

  return `Tu Voz en Trainmex — ${detail.label}. ${detail.examples}\n\nCuéntame lo que deseas compartir. En esta etapa no se registra ningún expediente.`;
}

/**
 * @param {ActiveService | undefined} service
 * @returns {CategoryKey | null}
 */
function categoryForService(service) {
  if (service?.categoria === "Nómina y prestaciones") return "payroll";
  if (service?.categoria === "Políticas y procedimientos") return "policies";
  if (service?.categoria === "Tu Voz en Trainmex") return "voice";
  return null;
}

/**
 * @param {ActiveService | undefined} service
 * @returns {VoiceTopic | null}
 */
function voiceTopicForService(service) {
  if (
    service?.categoria !== "Tu Voz en Trainmex" ||
    typeof service.subcategoria !== "string"
  ) {
    return null;
  }
  if (service.subcategoria === "Quejas y denuncias") return "complaints";
  if (service.subcategoria === "Ideas y mejoras") return "ideas";
  return null;
}

/**
 * @param {number} option
 * @returns {CategoryKey | null}
 */
function categoryForNumber(option) {
  return CATEGORY_OPTIONS[option - 1]?.key ?? null;
}

/**
 * @param {number} option
 * @returns {VoiceTopic | null}
 */
function voiceTopicForNumber(option) {
  return VOICE_OPTIONS[option - 1]?.key ?? null;
}

/**
 * This manager retains only a menu/category state per normalized phone number.
 * It never stores message text, service IDs, or conversation transcripts.
 *
 * @param {ConversationDependencies} dependencies
 * @param {Map<string, ConversationState>} [sessionStore]
 * @returns {{
 *   handleMessage: (senderPhone: string, messageText: string) => Promise<ConversationResult>;
 *   sessionStore: Map<string, ConversationState>;
 * }}
 */
export function createConversationManager(dependencies, sessionStore = new Map()) {
  /**
   * @param {string} text
   * @returns {Promise<IntentClassification>}
   */
  async function classifyIntent(text) {
    const activeServices = await dependencies.listActiveServices();
    const result = await dependencies.classifyService(text, activeServices);
    if (result.classification !== "clasificado" || !result.serviceId) {
      return { intent: null, classification: EMPTY_CLASSIFICATION };
    }

    const service = activeServices.find(
      ({ idServicio }) => idServicio === result.serviceId
    );
    if (!service) {
      return { intent: null, classification: EMPTY_CLASSIFICATION };
    }

    const category = categoryForService(service);
    if (!category) {
      return { intent: null, classification: EMPTY_CLASSIFICATION };
    }

    return {
      intent: {
        category,
        voiceTopic: voiceTopicForService(service)
      },
      classification: "clasificado"
    };
  }

  /**
   * @param {ConversationState} state
   * @param {ConversationIntent} intent
   * @param {boolean} alreadyExplained
   * @param {string} [prefix]
   * @returns {Promise<string>}
   */
  async function routeIntent(state, intent, alreadyExplained, prefix = "") {
    if (intent.category === "voice" && intent.voiceTopic) {
      return enterVoiceTopic(
        state,
        intent.voiceTopic,
        alreadyExplained,
        prefix
      );
    }
    return enterCategory(state, intent.category, alreadyExplained, prefix);
  }

  /**
   * @param {string} senderPhone
   * @param {string} messageText
   * @returns {Promise<ConversationResult>}
   */
  async function handleMessage(senderPhone, messageText) {
    const phone = String(senderPhone ?? "").replace(/\D/g, "");
    const text = String(messageText ?? "").trim();
    const normalized = normalizeInput(text);
    if (!phone || !normalized) {
      return makeResult("not_found", "ignored", "");
    }

    const collaboratorStatus = await dependencies.lookupCollaborator(phone);
    if (collaboratorStatus !== "active") {
      sessionStore.delete(phone);
      return makeResult(
        collaboratorStatus,
        "access_denied",
        "No puedo continuar porque este número no está autorizado en el directorio de RH."
      );
    }

    const isNewConversation = !sessionStore.has(phone);
    const state = sessionStore.get(phone) ?? {
      screen: "main_menu",
      category: null,
      voiceTopic: null,
      hasExplainedNeed: false,
      awaitingCorrection: false
    };

    const command = commandFor(normalized);
    if (command === "cancel") {
      sessionStore.delete(phone);
      return makeResult(
        collaboratorStatus,
        "cancelled",
        "Listo, cancelé esta simulación. No se registró ningún trámite."
      );
    }

    if (command === "menu") {
      return makeResult(
        collaboratorStatus,
        "menu",
        showMainMenu(state, isNewConversation)
      );
    }

    if (command === "back") {
      if (state.screen === "category" && state.category === "voice") {
        state.screen = "voice_submenu";
        state.voiceTopic = null;
        state.hasExplainedNeed = false;
        state.awaitingCorrection = false;
        sessionStore.set(phone, state);
        return makeResult(
          collaboratorStatus,
          "back",
          voiceSubmenuText()
        );
      }
      return makeResult(
        collaboratorStatus,
        "back",
        showMainMenu(state, false)
      );
    }

    if (command === "correct") {
      state.awaitingCorrection = true;
      sessionStore.set(phone, state);
      return makeResult(
        collaboratorStatus,
        "correction",
        "Claro. ¿Quieres cambiar la categoría o corregir lo que contaste? Puedes elegir 1, 2 o 3, o escribir la corrección en una frase."
      );
    }

    if (state.awaitingCorrection) {
      const option = parseOptionNumber(normalized, 3);
      const correctedCategory = option ? categoryForNumber(option) : null;
      if (correctedCategory) {
        const reply = enterCategory(
          state,
          correctedCategory,
          false
        );
        sessionStore.set(phone, state);
        return makeResult(collaboratorStatus, "category_changed", reply);
      }

      const explicit = explicitCategoryChoice(normalized);
      const classified = explicit
        ? {
            intent: { category: explicit, voiceTopic: null },
            classification: null
          }
        : await classifyIntent(text);
      if (classified.intent) {
        const reply = await routeIntent(
          state,
          classified.intent,
          true,
          isNewConversation
            ? "Hola, soy Catarina, recepcionista virtual de RH. "
            : ""
        );
        sessionStore.set(phone, state);
        return makeResult(
          collaboratorStatus,
          "correction_applied",
          reply,
          classified.classification
        );
      }

      state.awaitingCorrection = false;
      state.hasExplainedNeed = true;
      sessionStore.set(phone, state);
      return makeResult(
        collaboratorStatus,
        "correction_applied",
        `No logré ubicar la corrección. ¿Se trata de ${CATEGORY_OPTIONS[0].label}, ${CATEGORY_OPTIONS[1].label} o ${CATEGORY_OPTIONS[2].label}? Puedes responder 1, 2 o 3.`,
        classified.classification
      );
    }

    if (state.screen === "main_menu") {
      const option = parseOptionNumber(normalized, 3);
      const explicit = explicitCategoryChoice(normalized);
      const category = option ? categoryForNumber(option) : explicit;
      if (category) {
        const reply = enterCategory(
          state,
          category,
          false,
          isNewConversation
            ? "Hola, soy Catarina, recepcionista virtual de RH.\n\n"
            : ""
        );
        sessionStore.set(phone, state);
        return makeResult(collaboratorStatus, "category_selected", reply);
      }

      if (isGreeting(normalized)) {
        sessionStore.set(phone, state);
        return makeResult(
          collaboratorStatus,
          "welcome",
          showMainMenu(state, isNewConversation)
        );
      }

      const classified = await classifyIntent(text);
      if (classified.intent) {
        const reply = await routeIntent(
          state,
          classified.intent,
          true,
          isNewConversation
            ? "Hola, soy Catarina, recepcionista virtual de RH. "
            : ""
        );
        sessionStore.set(phone, state);
        return makeResult(
          collaboratorStatus,
          "direct_entry",
          reply,
          classified.classification
        );
      }

      sessionStore.set(phone, state);
      return makeResult(
        collaboratorStatus,
        "clarify_category",
        `${isNewConversation ? "Hola, soy Catarina, recepcionista virtual de RH.\n\n" : ""}Para ubicarte, ¿se trata de ${CATEGORY_OPTIONS[0].label}, ${CATEGORY_OPTIONS[1].label} o ${CATEGORY_OPTIONS[2].label}? Puedes responder 1, 2 o 3.`,
        classified.classification
      );
    }

    if (state.screen === "voice_submenu") {
      const option = parseOptionNumber(normalized, 2);
      const voiceTopic = option ? voiceTopicForNumber(option) : null;
      if (voiceTopic) {
        const reply = enterVoiceTopic(state, voiceTopic, false);
        sessionStore.set(phone, state);
        return makeResult(collaboratorStatus, "voice_topic_selected", reply);
      }

      const classified = await classifyIntent(text);
      if (
        classified.intent?.category === "voice" &&
        classified.intent.voiceTopic
      ) {
        const reply = enterVoiceTopic(
          state,
          classified.intent.voiceTopic,
          true
        );
        sessionStore.set(phone, state);
        return makeResult(
          collaboratorStatus,
          "voice_direct_entry",
          reply,
          classified.classification
        );
      }
      if (classified.intent) {
        const reply = await routeIntent(
          state,
          classified.intent,
          true
        );
        sessionStore.set(phone, state);
        return makeResult(
          collaboratorStatus,
          "direct_entry",
          reply,
          classified.classification
        );
      }

      sessionStore.set(phone, state);
      return makeResult(
        collaboratorStatus,
        "clarify_voice_topic",
        "¿Quieres compartir una queja o denuncia, o una idea de mejora? Responde 1 o 2.",
        classified.classification
      );
    }

    const option = parseOptionNumber(normalized, 3);
    const explicit = explicitCategoryChoice(normalized);
    const category = option ? categoryForNumber(option) : explicit;
    if (category) {
      const reply = enterCategory(state, category, false);
      sessionStore.set(phone, state);
      return makeResult(collaboratorStatus, "category_changed", reply);
    }

    if (isGreeting(normalized)) {
      sessionStore.set(phone, state);
      const prompt = state.hasExplainedNeed
        ? "Sigo aquí. Puedes agregar un dato, corregir, regresar, pedir el menú principal o cancelar."
        : "Cuéntame brevemente qué necesitas. También puedes regresar, pedir el menú principal o cancelar.";
      return makeResult(collaboratorStatus, "continue", prompt);
    }

    // Keep the existing service classification for topic statistics on each
    // authorized narrative, but do not change the selected flow or expose it.
    const classified = await classifyIntent(text);
    state.hasExplainedNeed = true;
    sessionStore.set(phone, state);
    return makeResult(
      collaboratorStatus,
      "need_received",
      "Gracias, te escucho. Puedes agregar otro dato o usar «corregir», «regresar», «menú principal» o «cancelar». Esta simulación no guarda mensajes ni crea tickets, citas o expedientes.",
      classified.classification
    );
  }

  return { handleMessage, sessionStore };
}

/**
 * @param {unknown} payload
 * @param {{handleMessage: (senderPhone: string, messageText: string) => Promise<ConversationResult>}} manager
 * @returns {Promise<ConversationResult[]>}
 */
export async function processIncomingConversationEvent(payload, manager) {
  const messages = extractIncomingTextMessages(payload);
  /** @type {ConversationResult[]} */
  const results = [];
  for (const message of messages) {
    results.push(await manager.handleMessage(message.senderPhone, message.text));
  }
  return results;
}

/**
 * @param {ConversationResult[]} results
 */
export function summarizeConversationResults(results) {
  return {
    textMessages: results.length,
    active: results.filter(({ collaboratorStatus }) => collaboratorStatus === "active")
      .length,
    denied: results.filter(({ collaboratorStatus }) => collaboratorStatus !== "active")
      .length,
    classified: results.filter(({ classification }) => classification === "clasificado")
      .length,
    unclassified: results.filter(
      ({ classification }) => classification === EMPTY_CLASSIFICATION
    ).length
  };
}
