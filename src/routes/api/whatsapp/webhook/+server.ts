import { createHmac, timingSafeEqual } from "node:crypto";
import { json, type RequestHandler } from "@sveltejs/kit";
import {
  classificationFailureDetails,
  classifyService
} from "../../../../lib/server/gemini-service-classifier";
import {
  processIncomingConversationEvent,
  summarizeConversationResults
} from "../../../../lib/server/whatsapp-conversation.js";
import { createPayrollReception } from "../../../../lib/server/payroll-reception.ts";
import { createMemoryTicketRepository } from "../../../../lib/server/payroll-tickets.ts";
import {
  listActiveServices,
  lookupCollaboratorIdentity
} from "../../../../lib/server/neon-collaborators";

// Simulation remains explicit. The Neon write adapter is not activated here.
const conversationManager = createPayrollReception({
  lookupIdentity: lookupCollaboratorIdentity,
  listActiveServices,
  classifyService
}, createMemoryTicketRepository());

function isValidSignature(
  rawBody: Buffer,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  if (!signatureHeader || !/^sha256=[a-f0-9]{64}$/i.test(signatureHeader)) {
    return false;
  }

  const receivedDigest = Buffer.from(signatureHeader.slice("sha256=".length), "hex");
  const expectedDigest = createHmac("sha256", appSecret).update(rawBody).digest();

  return (
    receivedDigest.length === expectedDigest.length &&
    timingSafeEqual(receivedDigest, expectedDigest)
  );
}

function tokensMatch(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);

  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

export const GET: RequestHandler = ({ url }) => {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) {
    return new Response("Webhook not configured", { status: 503 });
  }

  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (
    mode === "subscribe" &&
    token !== null &&
    challenge !== null &&
    tokensMatch(token, verifyToken)
  ) {
    return new Response(challenge, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }

  return new Response("Forbidden", { status: 403 });
};

export const POST: RequestHandler = async ({ request }) => {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    return json(
      { received: false, error: "Webhook not configured" },
      { status: 503 }
    );
  }

  const rawBody = Buffer.from(await request.arrayBuffer());
  if (!isValidSignature(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
    return json(
      { received: false, error: "Invalid webhook signature" },
      { status: 401 }
    );
  }

  let payload: unknown;

  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return json({ received: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return json({ received: false, error: "Invalid webhook payload" }, { status: 400 });
  }

  let results;
  try {
    results = await processIncomingConversationEvent(
      payload,
      conversationManager
    );
  } catch (error) {
    // Never log request data, message text, phone numbers, model output, or errors.
    console.error(
      "[whatsapp-webhook] Conversation processing failed",
      classificationFailureDetails(error) ?? { kind: "processing", details: "omitted" }
    );
    return json(
      { received: false, error: "Message processing unavailable" },
      { status: 503 }
    );
  }

  // The generated conversation prompt is intentionally discarded. Only aggregate
  // processing counts are logged; no WhatsApp reply or user content is emitted.
  console.info(
    "[whatsapp-webhook] Conversation simulation completed",
    summarizeConversationResults(results)
  );

  return json({ received: true });
};
