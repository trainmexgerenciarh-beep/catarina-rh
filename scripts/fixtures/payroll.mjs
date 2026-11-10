export const phone = "000000000000001";
export const services = [
  ...["Pago semanal", "Despensa", "Gasolina", "Recibo de nómina",
    "Premios de puntualidad y asistencia", "Horas extra", "Descuentos", "Otros"].map(
    (subcategory, index) => ({
      idServicio: String(index + 1), categoria: "Nómina y prestaciones", subcategoria: subcategory
    })
  ),
  ...["Premios de puntualidad y asistencia", "Permisos", "Vacaciones",
    "Política de riesgos psicosociales", "Adelantos de nómina"].map(
    (subcategory, index) => ({
      idServicio: String(index + 9), categoria: "Políticas y procedimientos", subcategoria: subcategory
    })
  ),
  { idServicio: "14", categoria: "Tu Voz en Trainmex", subcategoria: "Quejas y denuncias" },
  { idServicio: "15", categoria: "Tu Voz en Trainmex", subcategoria: "Ideas y mejoras" }
];

export function dependencies() {
  return {
    lookupIdentity: async (sender) => sender === phone
      ? { status: "active", id: "SYNTHETIC" }
      : { status: sender.endsWith("2") ? "inactive" : sender.endsWith("3") ? "ambiguous" : "not_found", id: null },
    listActiveServices: async () => services,
    classifyService: async (text) => {
      const input = text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
      let id = null;
      if (/premio/.test(input)) id = /requisito|regla/.test(input) ? "9" : "5";
      else if (/pago semanal/.test(input)) id = "1";
      else if (/despensa/.test(input)) id = "2";
      else if (/gasolina/.test(input)) id = "3";
      else if (/vacacion/.test(input)) id = "11";
      else if (/queja/.test(input)) id = "14";
      return { serviceId: id, classification: id ? "clasificado" : "sin clasificar" };
    }
  };
}

export async function prepare(manager, suffix = "") {
  await manager.handleMessage(phone, "Me falta el pago semanal.", `need${suffix}`);
  return manager.handleMessage(phone, "06/11/2026", `date${suffix}`);
}
