import { GoogleGenAI } from "@google/genai";
import pg from "pg";

const EXPECTED_TABLES = [
  "bloqueos_agenda",
  "citas",
  "colaboradores",
  "consultas",
  "denuncias",
  "encuestas",
  "fuentes",
  "horarios_atencion",
  "seguimientos_denuncia",
  "servicios",
  "tickets"
];

function requiredSecret(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta el Secret requerido: ${name}`);
  }
  return value;
}

async function checkNeon() {
  const client = new pg.Client({
    connectionString: requiredSecret("DATABASE_URL"),
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000
  });

  try {
    await client.connect();
    const result = await client.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_type = 'BASE TABLE'
         AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [EXPECTED_TABLES]
    );

    const foundTables = result.rows.map((row) => row.table_name);
    const missingTables = EXPECTED_TABLES.filter(
      (tableName) => !foundTables.includes(tableName)
    );

    if (missingTables.length > 0) {
      throw new Error(
        `Faltan tablas documentadas: ${missingTables.join(", ")}. No se modificó el esquema.`
      );
    }

    console.log(`Neon: conexión verificada; ${foundTables.length} de 11 tablas encontradas.`);
  } finally {
    await client.end().catch(() => {});
  }
}

async function checkGemini() {
  const ai = new GoogleGenAI({ apiKey: requiredSecret("GEMINI_API_KEY") });
  await ai.models.generateContent({
    model: "gemini-flash-latest",
    contents: "Responde únicamente con OK.",
    config: { maxOutputTokens: 8, temperature: 0 }
  });
  console.log("Gemini: llamada breve completada con @google/genai.");
}

let failed = false;

try {
  await checkNeon();
} catch (error) {
  failed = true;
  const detail =
    error instanceof Error && error.message.startsWith("Faltan tablas")
      ? error.message
      : error instanceof Error && error.message.startsWith("Falta el Secret")
        ? error.message
        : "falló la conexión o consulta; verifica el Secret y el acceso a Neon.";
  console.error(`Neon: ${detail}`);
}

try {
  await checkGemini();
} catch (error) {
  failed = true;
  const detail =
    error instanceof Error && error.message.startsWith("Falta el Secret")
      ? error.message
      : "falló la llamada de prueba; verifica el Secret, acceso a la API y disponibilidad del modelo.";
  console.error(`Gemini: ${detail}`);
}

if (failed) {
  process.exitCode = 1;
}
