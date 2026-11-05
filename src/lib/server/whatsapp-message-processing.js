/**
 * @typedef {"active" | "inactive" | "not_found" | "ambiguous"} CollaboratorStatus
 * @typedef {{ senderPhone: string; text: string }} IncomingTextMessage
 * @typedef {{ collaboratorStatus: CollaboratorStatus; topic: string }} ProcessedMessage
 * @typedef {{
 *   lookupCollaborator: (senderPhone: string) => Promise<CollaboratorStatus>;
 *   classifyTopic: (text: string) => Promise<string>;
 * }} MessageProcessingDependencies
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Extract only plain-text messages from official WhatsApp Business message
 * change events. The returned sender number is normalized to digits for lookup.
 *
 * @param {unknown} payload
 * @returns {IncomingTextMessage[]}
 */
export function extractIncomingTextMessages(payload) {
  if (!isRecord(payload) || payload.object !== "whatsapp_business_account") {
    return [];
  }

  const messages = [];
  const entries = Array.isArray(payload.entry) ? payload.entry : [];

  for (const entry of entries) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) continue;

    for (const change of entry.changes) {
      if (!isRecord(change) || change.field !== "messages" || !isRecord(change.value)) {
        continue;
      }

      const eventMessages = Array.isArray(change.value.messages)
        ? change.value.messages
        : [];

      for (const message of eventMessages) {
        if (!isRecord(message) || message.type !== "text" || !isRecord(message.text)) {
          continue;
        }

        if (typeof message.from !== "string" || typeof message.text.body !== "string") {
          continue;
        }

        const senderPhone = message.from.replace(/\D/g, "");
        if (!senderPhone || message.text.body.trim().length === 0) continue;

        messages.push({ senderPhone, text: message.text.body });
      }
    }
  }

  return messages;
}

/**
 * Look up each sender and classify each extracted text message. Results contain
 * status and topic only; sender numbers and message text are not retained.
 *
 * @param {unknown} payload
 * @param {MessageProcessingDependencies} dependencies
 * @returns {Promise<ProcessedMessage[]>}
 */
export async function processIncomingMessages(payload, dependencies) {
  const incomingMessages = extractIncomingTextMessages(payload);
  const results = [];

  for (const message of incomingMessages) {
    const collaboratorStatus = await dependencies.lookupCollaborator(
      message.senderPhone
    );
    const topic = await dependencies.classifyTopic(message.text);
    results.push({ collaboratorStatus, topic });
  }

  return results;
}

/**
 * Build safe aggregate counts for logs. No sender or message content is included.
 *
 * @param {ProcessedMessage[]} results
 */
export function summarizeProcessingResults(results) {
  const summary = {
    textMessages: results.length,
    active: 0,
    inactive: 0,
    notFound: 0,
    ambiguous: 0,
    classified: 0
  };

  for (const result of results) {
    summary.classified += 1;
    switch (result.collaboratorStatus) {
      case "active":
        summary.active += 1;
        break;
      case "inactive":
        summary.inactive += 1;
        break;
      case "not_found":
        summary.notFound += 1;
        break;
      case "ambiguous":
        summary.ambiguous += 1;
        break;
    }
  }

  return summary;
}
