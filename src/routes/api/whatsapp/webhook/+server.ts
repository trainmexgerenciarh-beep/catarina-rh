import { createHmac, timingSafeEqual } from "node:crypto";
import { json, type RequestHandler } from "@sveltejs/kit";

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

  const entries = Array.isArray((payload as { entry?: unknown }).entry)
    ? (payload as { entry: unknown[] }).entry
    : [];

  const messageCount = entries.reduce((total, entry) => {
    if (typeof entry !== "object" || entry === null) return total;
    const changes = (entry as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) return total;

    return (
      total +
      changes.reduce((changeTotal, change) => {
        if (typeof change !== "object" || change === null) return changeTotal;
        const value = (change as { value?: unknown }).value;
        if (typeof value !== "object" || value === null) return changeTotal;
        const messages = (value as { messages?: unknown }).messages;
        return changeTotal + (Array.isArray(messages) ? messages.length : 0);
      }, 0)
    );
  }, 0);

  // Do not log or persist message content, phone numbers, or other payload data.
  console.info("[whatsapp-webhook] Notification received", { messageCount });

  return json({ received: true });
};
