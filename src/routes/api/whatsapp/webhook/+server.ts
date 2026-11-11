import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "@sveltejs/kit";
import { classifyService } from "../../../../lib/server/gemini-service-classifier";
import { createDurableConversation } from "../../../../lib/server/durable-conversation.ts";
import { createWebhookPost } from "../../../../lib/server/whatsapp-webhook-post.ts";
import {
  listActiveServices,
  lookupCollaboratorIdentity,
  getNeonPool
} from "../../../../lib/server/neon-collaborators";

// Lazy: invalid signatures/payloads cannot even select a business repository.
// SIMULATION_ONLY remains a strict NO-OUTBOUND contract, not an in-memory DB.
let conversationManager: ReturnType<typeof createDurableConversation> | undefined;
const manager=()=>conversationManager??=createDurableConversation({
  lookupIdentity:lookupCollaboratorIdentity,listActiveServices,classifyService
},getNeonPool());

// Release old process-local timers on dev hot reload; no durable state is touched.
(import.meta as ImportMeta & { hot?: { dispose(fn: () => void): void } })
  .hot?.dispose(() => conversationManager?.dispose());

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

export const POST: RequestHandler = createWebhookPost(manager);
