import { createHmac } from "node:crypto";

const appSecret = process.env.WHATSAPP_APP_SECRET;
const devDomain = process.env.REPLIT_DEV_DOMAIN;

if (!appSecret) {
  console.error("Falta el Secret WHATSAPP_APP_SECRET.");
  process.exit(1);
}

if (!devDomain) {
  console.error("No está disponible REPLIT_DEV_DOMAIN para probar el webhook.");
  process.exit(1);
}

const endpoint = `https://${devDomain}/api/whatsapp/webhook`;
const body = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: {
            messages: [
              {
                id: "wamid.test",
                from: "000000000000000",
                type: "text",
                text: { body: "webhook signature test" }
              }
            ]
          }
        }
      ]
    }
  ]
});

const validDigest = createHmac("sha256", appSecret).update(body).digest("hex");
const invalidFirstCharacter = validDigest[0] === "0" ? "1" : "0";
const invalidSignature = `sha256=${invalidFirstCharacter}${validDigest.slice(1)}`;

async function post(signature) {
  const headers = { "content-type": "application/json" };
  if (signature !== null) {
    headers["x-hub-signature-256"] = signature;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body
  });
  return response;
}

try {
  const validSignature = await post(`sha256=${validDigest}`);
  if (validSignature.status !== 200) {
    throw new Error(`Firma válida: se esperaba 200, se recibió ${validSignature.status}.`);
  }
  console.log("Firma válida: HTTP 200.");

  const invalid = await post(invalidSignature);
  if (invalid.status !== 401) {
    throw new Error(`Firma incorrecta: se esperaba 401, se recibió ${invalid.status}.`);
  }
  console.log("Firma incorrecta: HTTP 401.");

  const missing = await post(null);
  if (missing.status !== 401) {
    throw new Error(`Firma ausente: se esperaba 401, se recibió ${missing.status}.`);
  }
  console.log("Firma ausente: HTTP 401.");
} catch (error) {
  const message =
    error instanceof Error && error.message.startsWith("Firma")
      ? error.message
      : "No se pudo completar la prueba del webhook.";
  console.error(message);
  process.exitCode = 1;
}
