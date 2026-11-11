import type { ConnectionPool } from "./persistence-unit.ts";
import { createNeonTicketRepository } from "./payroll-tickets.ts";
import { createNeonAgendaRepository } from "./neon-agenda.ts";
import { persistentAgendaPort } from "./agenda-port.ts";
import { createAgendaReception } from "./agenda-reception.ts";
import type { createPayrollReception } from "./payroll-reception.ts";

/** Only composition: the original payroll/menu and agenda engines remain the
 * business implementation. No sending API exists in this module.
 */
export function createPersistentReception(
  dependencies: Parameters<typeof createPayrollReception>[0],pool: ConnectionPool,
  options: {now?:()=>number} = {}
) {
  return createAgendaReception(dependencies,createNeonTicketRepository(pool),
    persistentAgendaPort(createNeonAgendaRepository(pool,{mode:"SIMULATION_ONLY"})),options);
}
