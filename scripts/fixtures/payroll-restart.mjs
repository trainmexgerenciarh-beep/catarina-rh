// Isolated fake database on a temporary file. Never imports a Neon connection.
import { readFile, writeFile } from "node:fs/promises";
import { createPayrollReception } from "../../src/lib/server/payroll-reception.ts";
import { createMemoryTicketRepository } from "../../src/lib/server/payroll-tickets.ts";
import { dependencies, phone, prepare } from "./payroll.mjs";

const [file, phase] = process.argv.slice(2);
const seed = phase === "replay" ? JSON.parse(await readFile(file, "utf8")) : [];
const repository = createMemoryTicketRepository(seed);
const manager = createPayrollReception(dependencies(), repository);
if (phase !== "replay") await prepare(manager);
const result = await manager.handleMessage(phone, "confirmo", "wamid.synthetic.confirmation");
await writeFile(file, JSON.stringify(repository.snapshot()));
process.stdout.write(JSON.stringify({
  folio: result.ticket?.folio, count: repository.snapshot().length, action: result.action
}));
