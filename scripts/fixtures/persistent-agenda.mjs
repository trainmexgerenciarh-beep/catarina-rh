// Entirely fictional SQL model. No pg import, connection, env or network access.
// Simulates one database with transactional snapshots and a global mutex.
export function fakeDatabase() {
  let data = {
    tickets: [1, 2, 3, 4].map(id => ({
      id: String(id), collaboratorId: id === 3 ? "SYNTHETIC-B" : "SYNTHETIC-A",
      serviceId: "1", confirmationId: `wamid.SYNTHETIC-ticket-${id}`,
      description: "Ficticio", summary: "Ficticio", status: "pendiente de cita",
      closedAt: null, resolvedAt: null, outcome: null
    })),
    appointments: [], receipts: [],
    hours: [1, 2, 3, 4, 5].map(day => ({ day, begin: "14:00", end: "17:30", duration: 20 })),
    blocks: [], active: { "SYNTHETIC-A": true, "SYNTHETIC-B": true }, service: true
  };
  let tail = Promise.resolve(), sequence = 0;
  const db = {
    now: Date.parse("2026-11-16T18:00:00Z"), calls: [], connections: 0, fault: null,
    advanceAtLock: 0, advanceAtWrite: 0, writeError: null,
    snapshot: () => structuredClone(data),
    edit: fn => fn(data),
    pool: {
      async connect() {
        const connection = ++db.connections;
        let state, unlock;
        const answer = rows => ({ rows, rowCount: rows.length });
        const canAccess = t => t && data.active[t.collaboratorId] && data.service;
        return {
          async query(sql, params = []) {
            db.calls.push({ connection, sql, params });
            if (sql === "BEGIN" || sql.startsWith("SET LOCAL")) return answer([]);
            if (sql.includes("pg_advisory_xact_lock")) {
              const previous = tail;
              tail = new Promise(resolve => { unlock = resolve; });
              await previous;
              state = structuredClone(data);
              db.now += db.advanceAtLock; db.advanceAtLock = 0;
              return answer([]);
            }
            if (sql === "ROLLBACK") { state = undefined; return answer([]); }
            if(sql.includes("c4:owner")) return answer(state.appointments.filter(r =>
              r.status==="PROGRAMADA" && state.tickets.some(t => t.id===r.ticketId &&
                t.collaboratorId===params[0] && canAccess(t))));
            if(sql.includes("c4:pending")) return answer(state.tickets.filter(t =>
              t.collaboratorId===params[0] && canAccess(t) && t.status==="pendiente de cita" &&
              !t.closedAt && !t.resolvedAt &&
              !state.appointments.some(a=>a.ticketId===t.id && a.status==="PROGRAMADA")));
            if (sql === "COMMIT") {
              if (db.fault === "before-commit") { db.fault = null; throw new Error("PRIVATE_SQL"); }
              if (state) data = state;
              if (db.fault === "after-commit") { db.fault = null; throw new Error("PRIVATE_SQL"); }
              return answer([]);
            }
            if (db.fault === "connection") throw new Error("PRIVATE_SQL");
            if (sql.includes("c2:receipt")) return answer(state.receipts.filter(r => r.eventId === params[0]));
            if (sql.includes("c2:ticket-event")) return answer(state.tickets.filter(t => t.confirmationId === params[0]));
            if (sql.includes("FROM public.operaciones_citas")) {
              return answer(state.receipts.filter(r => r.eventId === params[0]));
            }
            if (sql.includes("c2:authorize") || sql.includes("c2:close-access")) {
              const t = state.tickets.find(t => t.id === params[0] && t.collaboratorId === params[1]);
              return answer(canAccess(t) ? [{ status: t.status, closed: t.closedAt, resolved: t.resolvedAt }] : []);
            }
            if (sql.includes("c2:own")) return answer(state.appointments.filter(r => r.id === params[0] && r.ticketId === params[1]));
            if (sql.includes("c2:hours")) return answer(state.hours);
            if (sql.includes("c2:blocks")) return answer(state.blocks);
            if (sql.includes("c2:occupied")) return answer(state.appointments.filter(r => r.status === "PROGRAMADA"));
            if (sql.includes("c2:clock")) return answer([{ now: String(db.now) }]);
            if (sql.includes("c2:book") || sql.includes("c2:change")) {
              if (db.writeError) throw Object.assign(new Error("PRIVATE_SQL"), { code: db.writeError });
              db.now += db.advanceAtWrite; db.advanceAtWrite = 0;
              const booking = sql.includes("c2:book");
              const source = booking ? null : state.appointments.find(r => r.id === params[0] && r.ticketId === params[1]);
              const start = params[booking ? 1 : 2], status = booking ? "PROGRAMADA" : params[3];
              if (Date.parse(start) - db.now < 7_200_000 && status !== "CANCELADA") return answer([]);
              if (!booking && (!source || source.status !== "PROGRAMADA" ||
                Date.parse(source.start) - db.now < 7_200_000)) return answer([]);
              const row = {
                id: booking ? String(++sequence) : source.id,
                ticketId: booking ? params[0] : source.ticketId, start,
                end: new Date(Date.parse(start) + 1_200_000).toISOString(),
                modality: booking ? params[2] : source.modality, status
              };
              if (status === "PROGRAMADA" && state.appointments.some(r =>
                r.id !== row.id && r.status === "PROGRAMADA" &&
                Date.parse(r.start) < Date.parse(row.end) && Date.parse(row.start) < Date.parse(r.end))) {
                throw Object.assign(new Error("PRIVATE_SQL"), { code: "23P01" });
              }
              if (booking) state.appointments.push(row); else Object.assign(source, row);
              return answer([row]);
            }
            if (sql.includes("c2:save-receipt")) {
              if (db.fault === "receipt") { db.fault = null; throw new Error("PRIVATE_SQL"); }
              if (state.receipts.some(r => r.eventId === params[0])) throw Object.assign(new Error("PRIVATE_SQL"), { code: "23505" });
              state.receipts.push({
                eventId: params[0], operation: params[1], ticketId: params[2],
                appointmentId: params[3], fingerprint: params[4], result: JSON.parse(params[5])
              });
              return answer([]);
            }
            if (sql.includes("FROM public.colaboradores") && !sql.includes("FROM public.tickets") &&
              !sql.startsWith("UPDATE public.tickets")) {
              return answer(state.active[params[0]] && state.service ? [{}] : []);
            }
            if (sql.includes("FROM public.servicios") && !sql.includes("FROM public.tickets") &&
              !sql.startsWith("UPDATE public.tickets")) return answer(state.service ? [{}] : []);
            if (sql.startsWith("INSERT INTO public.tickets")) {
              if (state.tickets.some(t => t.confirmationId === params[4])) return answer([]);
              const row = {
                id: String(100 + ++sequence), collaboratorId: params[0], serviceId: params[1],
                description: params[2], summary: params[3], confirmationId: params[4],
                status: "pendiente de cita", closedAt: null, resolvedAt: null, outcome: null
              };
              state.tickets.push(row); return answer([row]);
            }
            if (sql.startsWith("UPDATE public.tickets")) {
              const t = state.tickets.find(t => t.id === params[0] && t.collaboratorId === params[1]);
              const occupied = state.appointments.some(r => r.ticketId === params[0] && r.status !== "CANCELADA");
              if (!canAccess(t) || occupied || t.status !== "pendiente de cita" || t.resolvedAt) return answer([]);
              Object.assign(t, { status: "cerrado sin cita", closedAt: new Date(db.now).toISOString(), outcome: params[2] });
              return answer([t]);
            }
            if (sql.includes("FROM public.tickets WHERE id_mensaje_confirmacion")) return answer(state.tickets.filter(t => t.confirmationId === params[0]));
            if (sql.includes("FROM public.tickets") && sql.includes("id_ticket = $1")) {
              return answer(state.tickets.filter(t => t.id === params[0] && t.collaboratorId === params[1] && canAccess(t)));
            }
            throw new Error("UNMODELED_SQL");
          },
          release() { state = undefined; unlock?.(); }
        };
      }
    }
  };
  return db;
}
