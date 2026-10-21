import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";

const periodSchema = Type.String({
  description:
    "Shift/period filter. Accepts morning/afternoon/evening or PT-BR variants (with or without accents).",
});

type JsonRecord = Record<string, unknown>;
type LooseInt = number | string | undefined;
const BACKEND_TIMEOUT_MS = 15000;
const SCHEDULER_STATE_PATH = `${homedir()}/.openclaw/workspace/hospital/plugins/.scheduler-state.json`;
const INTERNAL_SCHEDULING_TOOL_NAMES = new Set([
  "hospital_get_patient_by_phone",
  "hospital_create_or_update_insurance",
  "hospital_list_insurance_options",
  "hospital_create_patient",
  "hospital_list_specialties",
  "hospital_list_doctors",
  "hospital_list_doctor_shifts",
  "hospital_list_shifts",
  "hospital_list_available_dates",
  "hospital_list_available_slots",
  "hospital_list_week_schedule",
  "hospital_create_appointment",
]);

function toInt(value: LooseInt): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parseTaggedNumber(value: unknown, tags: string[]): number | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  for (const tag of tags) {
    const re = new RegExp(`^${tag}:(\\d+)$`, "i");
    const m = re.exec(trimmed);
    if (m) return Number.parseInt(m[1], 10);
  }
  return undefined;
}

function normalizePeriod(value?: string): "morning" | "afternoon" | "evening" | undefined {
  if (!value) return undefined;

  const v = normalizeText(value);

  if (v === "1") return "morning";
  if (v === "2") return "afternoon";
  if (v === "3") return "evening";

  if (isNewBookingIntent(value) && !isBareChoice(value)) return undefined;

  if (v === "morning" || v === "afternoon" || v === "evening") return v;

  // PT-BR aliases, with tolerance for common misspellings.
  if (v === "manha" || v === "amanha" || v === "matina" || v.startsWith("manh") || v.includes("manha")) {
    return "morning";
  }
  if (v === "tarde" || v.startsWith("tard") || v.includes("tarde") || v === "afternon" || v === "afternoom") {
    return "afternoon";
  }
  if (
    v === "noite" ||
    v.startsWith("noit") ||
    v.includes("noite") ||
    v === "vespertino" ||
    v === "notie" || // transposition typo
    v === "evning" || // common typo
    v === "evenning"
  ) {
    return "evening";
  }

  return undefined;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | undefined | null>,
): string {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function callBackend(args: {
  baseUrl: string;
  apiKey?: string;
  method: "GET" | "POST";
  path: string;
  phone?: string;
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
}): Promise<JsonRecord> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (args.apiKey) {
    headers["X-API-Key"] = args.apiKey;
  }
  if (args.phone) {
    headers["X-Patient-Phone"] = args.phone;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(buildUrl(args.baseUrl, args.path, args.query), {
      method: args.method,
      headers,
      body: args.body ? JSON.stringify(args.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `backend timeout after ${BACKEND_TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : "backend request failed";
    return {
      http_status: 599,
      response: { error: message },
    };
  } finally {
    clearTimeout(timer);
  }

  const rawText = await res.text();
  let payload: unknown = null;
  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = { message: rawText };
    }
  }

  return {
    http_status: res.status,
    response: payload,
  };
}

function extractTotal(response: unknown): number | undefined {
  if (!response || typeof response !== "object") return undefined;
  const total = (response as { total?: unknown }).total;
  if (typeof total === "number" && Number.isFinite(total)) return total;
  return undefined;
}

function toDateOnly(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return m ? m[1] : undefined;
}

function plusDays(base: Date, days: number): Date {
  const out = new Date(base);
  out.setDate(out.getDate() + days);
  return out;
}

function asIsoDate(d: Date): string {
  // Keep local calendar date to avoid UTC day drift.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function weekdayPt(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const names = [
    "domingo",
    "segunda-feira",
    "terca-feira",
    "quarta-feira",
    "quinta-feira",
    "sexta-feira",
    "sabado",
  ];
  return names[d.getDay()] ?? "";
}

function slotLabelPt(args: {
  date: string;
  weekday: string;
  horario: string;
  doctorName?: string;
  periodo?: string;
}): string {
  const doctor = args.doctorName ? ` - Dr(a). ${args.doctorName}` : "";
  const period = args.periodo ? ` (${args.periodo})` : "";
  return `${args.weekday}, ${args.date} ${args.horario}${doctor}${period}`;
}

function formatDatePt(date: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return parts ? `${parts[3]}/${parts[2]}` : date;
}

function appointmentLabel(date: string | undefined, time: string): string {
  const horario = normalizeTime(time) || time;
  if (!date) return horario;
  return `${weekdayPt(date)}, ${formatDatePt(date)} ${horario}`;
}

function dateChoiceLabel(args: { date: string; weekday: string; slotCount: number }): string {
  const countText = args.slotCount === 1 ? "1 horario" : `${args.slotCount} horarios`;
  return `${args.weekday}, ${args.date} (${countText})`;
}

function compactSlotTimes(slots: Array<JsonRecord>): string {
  const times = Array.from(
    new Set(slots.map((slot) => normalizeTime(slot.horario)).filter((time) => time.length > 0)),
  ).slice(0, 4);
  if (times.length === 0) return "horarios disponiveis";
  const suffix = slots.length > 1 ? ` (${slots.length} vagas)` : " (1 vaga)";
  return `${times.join(", ")}${suffix}`;
}

function normalizeTime(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const isoDuration = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(raw);
  if (isoDuration) {
    const hh = String(Number(isoDuration[1] ?? "0")).padStart(2, "0");
    const mm = String(Number(isoDuration[2] ?? "0")).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  return raw;
}

function timeToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function filterPastTodaySlots<T extends { horario?: unknown }>(slots: T[], dateStr: string): T[] {
  const today = asIsoDate(new Date());
  if (dateStr !== today) return slots;

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return slots.filter((slot) => {
    const hhmm = normalizeTime(slot.horario);
    const minutes = timeToMinutes(hhmm);
    if (minutes === null) return true;
    return minutes > nowMinutes;
  });
}

type WeekFilters = {
  periodo?: string;
  specialty_id?: LooseInt;
  specialty_name?: string;
  doctor_id?: LooseInt;
  doctor_name?: string;
  start_date?: string;
  end_date?: string;
  days?: number;
};

function normalizeToolParams(input: unknown): Record<string, unknown> {
  let cur: unknown = input;
  for (let i = 0; i < 3; i++) {
    if (!cur || typeof cur !== "object") break;
    const obj = cur as Record<string, unknown>;
    const keys = Object.keys(obj);
    const wrapperOnly = keys.length > 0 && keys.every((k) => k === "args" || k === "id" || k === "name");
    if (wrapperOnly && obj.args && typeof obj.args === "object") {
      cur = obj.args;
      continue;
    }
    break;
  }
  return cur && typeof cur === "object" ? (cur as Record<string, unknown>) : {};
}

function resolveSpecialtyInput(raw: Record<string, unknown>): LooseInt {
  const explicitId = pickLooseInt(raw, ["specialty_id"]);
  if (explicitId !== undefined) return explicitId;
  const generic = raw.specialty;
  const genericNum = toInt(generic as LooseInt);
  if (genericNum !== undefined) return `index:${genericNum}`;
  return pickString(raw, ["specialty_name", "specialty", "especialidade"]);
}

function resolveDoctorInput(raw: Record<string, unknown>): LooseInt {
  const explicitId = pickLooseInt(raw, ["doctor_id"]);
  if (explicitId !== undefined) return explicitId;
  const generic = raw.doctor;
  const genericNum = toInt(generic as LooseInt);
  if (genericNum !== undefined) return `index:${genericNum}`;
  return pickString(raw, ["doctor_name", "doctor", "medico", "médico"]);
}

function pickString(params: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

function pickLooseInt(params: Record<string, unknown>, keys: string[]): LooseInt {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

function isIsoDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()));
}

async function buildWeekSchedule(
  baseUrl: string,
  apiKey: string | undefined,
  filters: WeekFilters,
): Promise<JsonRecord> {
  const resolvedSpecialtyId = await resolveSpecialtyId(
    baseUrl,
    apiKey,
    filters.specialty_id ?? filters.specialty_name,
  );
  const resolvedDoctorId = await resolveDoctorId(
    baseUrl,
    apiKey,
    filters.doctor_id ?? filters.doctor_name,
    resolvedSpecialtyId,
  );
  const normalizedPeriod = normalizePeriod(filters.periodo);
  if (!normalizedPeriod) {
    return {
      http_status: 200,
      response: {
        ok: false,
        reason: "missing_period",
        reply_text: "Qual periodo voce prefere?\n1) Manha\n2) Tarde\n3) Noite",
        message: "Periodo obrigatorio. Peça para escolher: manha, tarde ou noite.",
        choices: [
          { option_id: "period:morning", value: "morning", label: "Manha" },
          { option_id: "period:afternoon", value: "afternoon", label: "Tarde" },
          { option_id: "period:evening", value: "evening", label: "Noite" },
        ],
      },
    };
  }

  const today = new Date();
  const start = toDateOnly(filters.start_date) ?? asIsoDate(today);
  const requestedDays = Number.isFinite(Number(filters.days))
    ? Math.max(1, Math.min(14, Number(filters.days)))
    : 7;
  const startDate = new Date(`${start}T00:00:00`);
  const explicitEnd = toDateOnly(filters.end_date);
  const defaultEnd = asIsoDate(plusDays(startDate, requestedDays - 1));
  const end = explicitEnd ?? defaultEnd;

  let datesResp = await callBackend({
    baseUrl,
    apiKey,
    method: "GET",
    path: "/hospital/calendar/dates",
    query: {
      periodo: normalizedPeriod,
      specialty_id: resolvedSpecialtyId,
      doctor_id: resolvedDoctorId,
    },
  });

  if (
    normalizedPeriod === "afternoon" &&
    (((datesResp.response as { items?: Array<{ data?: string }> } | null)?.items ?? []).length === 0)
  ) {
    datesResp = await callBackend({
      baseUrl,
      apiKey,
      method: "GET",
      path: "/hospital/calendar/dates",
      query: {
        periodo: "evening",
        specialty_id: resolvedSpecialtyId,
        doctor_id: resolvedDoctorId,
      },
    });
  }

  // Keep only target range (next 7 days by default).
  const dateItems = (
    ((datesResp.response as { items?: Array<{ data?: string }> } | null)?.items ?? [])
      .map((x) => toDateOnly(x.data))
      .filter((x): x is string => Boolean(x))
      .filter((d) => d >= start && d <= end)
  );

  const byDate: Array<{ date: string; weekday: string; slots: Array<JsonRecord> }> = [];
  let totalSlots = 0;

  for (const d of dateItems) {
    const slotsResp = await callBackend({
      baseUrl,
      apiKey,
      method: "GET",
      path: "/hospital/calendar/slots",
      query: {
        data: d,
        periodo: normalizedPeriod,
        specialty_id: resolvedSpecialtyId,
        doctor_id: resolvedDoctorId,
      },
    });

    let slots = (((slotsResp.response as { items?: Array<Record<string, unknown>> } | null)?.items ?? []) as Array<
      Record<string, unknown>
    >).map((s) => ({
      ...s,
      horario: normalizeTime(s.horario),
    }));

    // Same fallback as other tools: afternoon often stored as evening in agenda.
    if (normalizedPeriod === "afternoon" && slots.length === 0) {
      const fallbackResp = await callBackend({
        baseUrl,
        apiKey,
        method: "GET",
        path: "/hospital/calendar/slots",
        query: {
          data: d,
          periodo: "evening",
          specialty_id: resolvedSpecialtyId,
          doctor_id: resolvedDoctorId,
        },
      });
      slots = (((fallbackResp.response as { items?: Array<Record<string, unknown>> } | null)?.items ?? []) as Array<
        Record<string, unknown>
      >).map((s) => ({
        ...s,
        horario: normalizeTime(s.horario),
      }));
    }

    slots = filterPastTodaySlots(slots, d);

    if (slots.length > 0) {
      totalSlots += slots.length;
      const weekday = weekdayPt(d);
      byDate.push({
        date: d,
        weekday,
        slots: slots as Array<JsonRecord>,
      });
    }
  }

  const effectiveDays = Math.max(
    1,
    Math.floor((new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) / 86400000) + 1,
  );

  let nextWeek: { window: { start_date: string; end_date: string }; total_dates: number; total_slots: number; items: Array<{ date: string; weekday: string; slots: Array<JsonRecord> }> } | null =
    null;
  const hasExplicitWindow = Boolean(filters.start_date || filters.end_date || filters.days !== undefined);
  if (!hasExplicitWindow && byDate.length === 0) {
    const endDate = new Date(`${end}T00:00:00`);
    const nextStartDate = plusDays(endDate, 1);
    const nextEndDate = plusDays(nextStartDate, 6);
    const nextWindow = await buildWeekSchedule(baseUrl, apiKey, {
      ...filters,
      start_date: asIsoDate(nextStartDate),
      end_date: asIsoDate(nextEndDate),
      days: undefined,
    });
    const r = (nextWindow.response as Record<string, unknown>) ?? {};
    nextWeek = {
      window: {
        start_date: String((r.window as Record<string, unknown> | undefined)?.start_date ?? asIsoDate(nextStartDate)),
        end_date: String((r.window as Record<string, unknown> | undefined)?.end_date ?? asIsoDate(nextEndDate)),
      },
      total_dates: Number(r.total_dates ?? 0),
      total_slots: Number(r.total_slots ?? 0),
      items: ((r.items as Array<{ date: string; weekday: string; slots: Array<JsonRecord> }> | undefined) ?? []),
    };
  }

  return {
    http_status: datesResp.http_status,
    response: {
      window: {
        start_date: start,
        end_date: end,
        days: effectiveDays,
      },
      filters_applied: {
        periodo: normalizedPeriod,
        specialty_id: resolvedSpecialtyId ?? null,
        doctor_id: resolvedDoctorId ?? null,
      },
      message:
        byDate.length > 0
          ? "Opcoes encontradas para os proximos dias."
          : nextWeek && nextWeek.total_slots > 0
            ? "Sem vagas no periodo inicial. Opcoes da semana seguinte em next_week."
            : "Sem vagas para os filtros informados nesta e na proxima semana.",
      reply_text:
        byDate.length > 0
          ? [
              "Escolha uma data:",
              ...byDate
                .slice(0, 7)
                .map((d, i) => `${i + 1}) ${d.weekday}, ${d.date} - ${compactSlotTimes(d.slots)}`),
              `${Math.min(byDate.length, 7) + 1}) Nenhuma dessas opcoes`,
            ].join("\n")
          : nextWeek && nextWeek.total_slots > 0
            ? "Nao encontrei horarios nesta semana. Posso mostrar a proxima semana?"
            : "Nao encontrei horarios para esses filtros nesta semana nem na proxima.",
      total_dates: byDate.length,
      total_slots: totalSlots,
      items: byDate,
      choices: [
        ...byDate.slice(0, 7).map((d, i) => ({
          option_id: `date:${d.date || i + 1}`,
          label: dateChoiceLabel({ date: d.date, weekday: d.weekday, slotCount: d.slots.length }),
          date: d.date,
          weekday: d.weekday,
          slot_count: d.slots.length,
        })),
        {
          option_id: nextWeek && nextWeek.total_slots > 0 ? "none:show_next_week" : "none:no_match",
          label:
            nextWeek && nextWeek.total_slots > 0
              ? "Nenhuma dessas opcoes (mostrar proxima semana)"
              : "Nenhuma dessas opcoes",
          agenda_id: null,
          date: "",
          time: "",
          doctor_name: null,
          periodo: null,
        },
      ],
      next_week: nextWeek,
    },
  };
}

async function listSpecialties(baseUrl: string, apiKey?: string): Promise<Array<{ id: number; nome: string }>> {
  const out = await callBackend({
    baseUrl,
    apiKey,
    method: "GET",
    path: "/hospital/calendar/specialties",
  });
  const response = out.response as { items?: Array<{ id?: unknown; nome?: unknown }> } | null;
  const items = response?.items ?? [];
  return items
    .map((item) => ({ id: toInt(item.id as LooseInt), nome: String(item.nome ?? "") }))
    .filter((item): item is { id: number; nome: string } => item.id !== undefined && item.nome.length > 0);
}

function extractItemsArray(response: unknown): Array<Record<string, unknown>> {
  const items = (response as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as Array<Record<string, unknown>>) : [];
}

async function resolveSpecialtyId(
  baseUrl: string,
  apiKey: string | undefined,
  value: LooseInt,
): Promise<number | undefined> {
  const specialties = await listSpecialties(baseUrl, apiKey);
  if (typeof value === "string") {
    const byIndex = /^index:(\d+)$/.exec(value.trim());
    if (byIndex) {
      const idx = Number.parseInt(byIndex[1], 10);
      return idx >= 1 && idx <= specialties.length ? specialties[idx - 1].id : undefined;
    }
  }
  const tagged = parseTaggedNumber(value, ["specialty", "especialidade"]);
  if (tagged !== undefined) {
    const byId = specialties.find((s) => s.id === tagged);
    if (byId) return byId.id;
  }

  // Check if value is a direct database ID before treating as list index.
  const asId = toInt(value);
  if (asId !== undefined) {
    const directById = specialties.find((s) => s.id === asId);
    if (directById) return directById.id;
  }

  const selectedIndex = toInt(value);
  if (selectedIndex !== undefined) {
    return selectedIndex >= 1 && selectedIndex <= specialties.length ? specialties[selectedIndex - 1].id : undefined;
  }
  if (typeof value !== "string" || value.trim() === "") return undefined;

  const needle = normalizeText(value);

  const exact = specialties.find((s) => normalizeText(s.nome) === needle);
  if (exact) return exact.id;

  const partial = specialties.find((s) => normalizeText(s.nome).includes(needle) || needle.includes(normalizeText(s.nome)));
  return partial?.id;
}

async function listDoctors(
  baseUrl: string,
  apiKey: string | undefined,
  specialtyId?: number,
): Promise<Array<{ id: number; nome: string }>> {
  const out = await callBackend({
    baseUrl,
    apiKey,
    method: "GET",
    path: "/hospital/calendar/doctors",
    query: { specialty_id: specialtyId },
  });
  const response = out.response as { items?: Array<{ id?: unknown; nome?: unknown }> } | null;
  const items = response?.items ?? [];
  return items
    .map((item) => ({ id: toInt(item.id as LooseInt), nome: String(item.nome ?? "") }))
    .filter((item): item is { id: number; nome: string } => item.id !== undefined && item.nome.length > 0);
}

async function resolveDoctorId(
  baseUrl: string,
  apiKey: string | undefined,
  value: LooseInt,
  specialtyId?: number,
): Promise<number | undefined> {
  const doctors = await listDoctors(baseUrl, apiKey, specialtyId);
  if (typeof value === "string") {
    const byIndex = /^index:(\d+)$/.exec(value.trim());
    if (byIndex) {
      const idx = Number.parseInt(byIndex[1], 10);
      return idx >= 1 && idx <= doctors.length ? doctors[idx - 1].id : undefined;
    }
  }
  const tagged = parseTaggedNumber(value, ["doctor", "medico", "médico"]);
  if (tagged !== undefined) {
    const byId = doctors.find((d) => d.id === tagged);
    if (byId) return byId.id;
  }

  // Check if value is a direct database ID before treating as list index.
  const asId = toInt(value);
  if (asId !== undefined) {
    const directById = doctors.find((d) => d.id === asId);
    if (directById) return directById.id;
  }

  const selectedIndex = toInt(value);
  if (selectedIndex !== undefined) {
    return selectedIndex >= 1 && selectedIndex <= doctors.length ? doctors[selectedIndex - 1].id : undefined;
  }
  if (typeof value !== "string" || value.trim() === "") return undefined;

  const needle = normalizeText(value);

  const exact = doctors.find((d) => normalizeText(d.nome) === needle);
  if (exact) return exact.id;

  const partial = doctors.find((d) => normalizeText(d.nome).includes(needle) || needle.includes(normalizeText(d.nome)));
  return partial?.id;
}

type SchedulerPhase =
  | "specialty"
  | "doctor"
  | "period"
  | "date"
  | "slot"
  | "patient_name"
  | "patient_cpf"
  | "patient_birth"
  | "patient_email"
  | "payment"
  | "insurance_plan"
  | "insurance_card"
  | "insurance_expiration"
  | "cancel_list"
  | "cancel_confirm"
  | "reschedule_prompt";

type SchedulerOption = {
  id?: number;
  label: string;
  value?: string;
  date?: string;
  agenda_id?: number;
  slots?: Array<JsonRecord>;
};

type SchedulerState = {
  phase: SchedulerPhase;
  specialty?: SchedulerOption;
  doctor?: SchedulerOption | null;
  period?: "morning" | "afternoon" | "evening";
  windowStart?: string;
  windowEnd?: string;
  dateOptions?: SchedulerOption[];
  slotOptions?: SchedulerOption[];
  insuranceOptions?: SchedulerOption[];
  selectedSlot?: SchedulerOption;
  slotPhaseEnteredAt?: number;
  phaseEnteredAt?: number;
  cancelOptions?: Array<{ id: number; label: string; specialty?: string; specialty_id?: number }>;
  selectedCancel?: { id: number; label: string; specialty?: string; specialty_id?: number };
  patient?: Record<string, unknown>;
  patientDraft?: {
    nome_completo?: string;
    cpf?: string;
    data_nascimento?: string;
    email?: string | null;
    payment_mode?: "particular" | "convenio";
    insurance_name?: string;
    carteirinha_id?: string;
    data_de_expiracao?: string | null;
  };
};

async function loadSchedulerStore(): Promise<Record<string, SchedulerState>> {
  try {
    return JSON.parse(await readFile(SCHEDULER_STATE_PATH, "utf8")) as Record<string, SchedulerState>;
  } catch {
    return {};
  }
}

async function saveSchedulerStore(store: Record<string, SchedulerState>): Promise<void> {
  await mkdir(dirname(SCHEDULER_STATE_PATH), { recursive: true });
  await writeFile(SCHEDULER_STATE_PATH, JSON.stringify(store, null, 2));
}

function cleanPhone(phone: string): string {
  let p = phone.trim().replace(/\s/g, "");
  // Strip any leading zeros or extra characters, then ensure +55 prefix.
  if (p.startsWith("+55")) return p;
  if (p.startsWith("55") && p.length >= 12) return `+${p}`;
  // Raw local number (e.g. 11976091856 or 11998983666) — prepend +55
  return `+55${p.replace(/^\+/, "")}`;
}

function isResetIntent(message: string): boolean {
  const text = normalizeText(message);
  return text === "recomecar" || text === "reiniciar" || text === "novo agendamento";
}

function isCancelIntent(message: string): boolean {
  const text = normalizeText(message);
  return (
    text.includes("cancelar") ||
    text.includes("cancela") ||
    text.includes("cancelo") ||
    text.includes("desmarcar") ||
    text.includes("desmarco") ||
    text.includes("cancelamento")
  );
}

function isNewBookingIntent(message: string): boolean {
  const text = normalizeText(message);
  // Don't treat cancel messages as new booking intent
  if (isCancelIntent(message)) return false;
  return (
    text.includes("consulta") ||
    text.includes("agendar") ||
    text.includes("marcar") ||
    text.includes("quero uma") ||
    text.includes("quero cardio")
  );
}

function isBareChoice(message: string): boolean {
  const text = normalizeText(message).replace(/[).:-]/g, " ").trim();
  return /^\d+$/.test(text) || text === "manha" || text === "tarde" || text === "noite";
}

function isPlausiblePersonName(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || isNewBookingIntent(trimmed) || isBareChoice(trimmed)) return false;
  if (normalizeText(trimmed).length < 5 || !/\s/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  if (words.length < 2 || words.length > 6) return false;
  if (words.some((word) => /(consulta|agendar|marcar|especialidade|medico|horario|cardiologia|ortopedia|pediatria)/i.test(word))) {
    return false;
  }
  return words.every((word) => /^[\p{L}'’-]+$/u.test(word));
}

function selectOptionByName(options: SchedulerOption[] | undefined, message: string): SchedulerOption | undefined {
  if (!options || options.length === 0) return undefined;
  const needle = normalizeText(message);
  if (!needle) return undefined;
  const tokens = needle.split(/[^a-z0-9]+/).filter((token) => token.length >= 4);
  const matches = options.filter((option) => {
    const label = normalizeText(option.label);
    if (!label) return false;
    if (label === needle || needle.includes(label)) return true;
    return tokens.some((token) => label === token || label.startsWith(token) || token.startsWith(label));
  });
  if (matches.length === 0) return undefined;
  return [...matches].sort((a, b) => normalizeText(b.label).length - normalizeText(a.label).length)[0];
}

function selectOption(options: SchedulerOption[] | undefined, message: string): SchedulerOption | undefined {
  if (!options || options.length === 0) return undefined;
  const trimmed = message.trim();
  if (/^\d+$/.test(trimmed)) {
    const n = toInt(trimmed);
    if (n !== undefined && n >= 1 && n <= options.length) return options[n - 1];
  }
  return selectOptionByName(options, message);
}

function numberedList(title: string, options: SchedulerOption[]): string {
  return [title, ...options.map((option, index) => `${index + 1}) ${option.label}`), "Responda com o numero da opcao."].join("\n");
}

function periodReply(): string {
  return "Qual periodo voce prefere?\n1) Manha\n2) Tarde\n3) Noite\nResponda com o numero da opcao.";
}

function dateOptionsFromWeekItems(items: Array<{ date: string; weekday: string; slots: Array<JsonRecord> }>): SchedulerOption[] {
  return items.slice(0, 7).map((item) => ({
    date: item.date,
    slots: item.slots,
    label: `${item.weekday}, ${formatDatePt(item.date)} - ${compactSlotTimes(item.slots)}`,
  }));
}

function schedulerSlotLabel(slot: JsonRecord, includeDoctor: boolean): string {
  const time = normalizeTime(slot.horario);
  const doctor = includeDoctor && slot.doctor_name ? ` - Dr(a). ${String(slot.doctor_name)}` : "";
  return `${time}${doctor}`;
}

function slotMatchesState(slot: JsonRecord, state: SchedulerState): boolean {
  const specialtyId = toInt(slot.specialty_id as LooseInt);
  const doctorId = toInt(slot.doctor_id as LooseInt);
  if (state.specialty?.id && specialtyId !== state.specialty.id) return false;
  if (state.doctor?.id && doctorId !== state.doctor.id) return false;
  return true;
}

function patientIdFrom(patient: Record<string, unknown> | undefined): number | undefined {
  return toInt(patient?.id as LooseInt);
}

function patientIsComplete(patient: Record<string, unknown> | undefined): boolean {
  if (!patient) return false;
  return Boolean(patient.nome_completo && patient.cpf && patient.data_nascimento);
}

async function getPatientByPhone(baseUrl: string, apiKey: string | undefined, phone: string): Promise<Record<string, unknown> | undefined> {
  const out = await callBackend({
    baseUrl,
    apiKey,
    method: "GET",
    path: `/hospital/patients/by-phone/${encodeURIComponent(phone)}`,
  });
  const response = out.response as { found?: boolean; patient?: Record<string, unknown> } | null;
  return response?.found ? response.patient : undefined;
}

async function upsertPatientFromState(
  baseUrl: string,
  apiKey: string | undefined,
  phone: string,
  state: SchedulerState,
): Promise<Record<string, unknown> | undefined> {
  const draft = state.patientDraft ?? {};
  const existing = state.patient ?? {};
  const nome = draft.nome_completo ?? String(existing.nome_completo ?? "");
  const cpf = draft.cpf ?? String(existing.cpf ?? "");
  const nascimento = draft.data_nascimento ?? String(existing.data_nascimento ?? "");
  if (!nome || !cpf || !nascimento) return undefined;

  await callBackend({
    baseUrl,
    apiKey,
    method: "POST",
    path: "/hospital/patients",
    phone,
    body: {
      nome_completo: nome,
      cpf,
      data_nascimento: nascimento,
      email: draft.email ?? (existing.email as string | null | undefined) ?? null,
      carteirinha_id: draft.carteirinha_id ?? (existing.carteirinha_id as string | null | undefined) ?? null,
    },
  });

  return getPatientByPhone(baseUrl, apiKey, phone);
}

async function finishSchedulerBooking(
  baseUrl: string,
  apiKey: string | undefined,
  phone: string,
  state: SchedulerState,
): Promise<{ reply_text: string; done: boolean }> {
  if (state.patientDraft?.payment_mode === "convenio") {
    const draft = state.patientDraft;
    if (draft.insurance_name && draft.carteirinha_id) {
      await callBackend({
        baseUrl,
        apiKey,
        method: "POST",
        path: "/hospital/insurance",
        body: {
          nome: draft.insurance_name,
          carteirinha_id: draft.carteirinha_id,
          data_de_expiracao: draft.data_de_expiracao ?? null,
        },
      });
    }
  }

  const patient = await upsertPatientFromState(baseUrl, apiKey, phone, state);
  const patientId = patientIdFrom(patient);
  const agendaId = state.selectedSlot?.agenda_id;
  if (!patientId || !agendaId) {
    return {
      done: false,
      reply_text: "Nao consegui finalizar o agendamento. Vamos recomecar: qual especialidade voce deseja?",
    };
  }

  const appointment = await callBackend({
    baseUrl,
    apiKey,
    method: "POST",
    path: "/hospital/appointments",
    body: {
      appointment_type: "consulta",
      patient_id: patientId,
      agenda_id: agendaId,
      status: "agendada",
    },
  });

  const response = appointment.response as Record<string, unknown> | null;
  const appointmentStatus = Number(appointment.http_status);
  if (appointmentStatus >= 200 && appointmentStatus < 300 && response?.ok === true) {
    return {
      done: true,
      reply_text: `Consulta agendada com sucesso para ${state.selectedSlot?.label ?? "o horario escolhido"}.`,
    };
  }

  return {
    done: false,
    reply_text: "Esse horario nao esta mais disponivel. Por favor, escolha outro horario.",
  };
}

async function promptDoctorChoice(
  baseUrl: string,
  apiKey: string | undefined,
  store: Record<string, SchedulerState>,
  phone: string,
  state: SchedulerState,
  selected: SchedulerOption,
): Promise<JsonRecord> {
  const doctors = await listDoctors(baseUrl, apiKey, selected.id);
  const doctorOptions = doctors.map((d) => ({ id: d.id, label: d.nome }));
  state.specialty = selected;
  state.phase = "doctor";
  state.dateOptions = doctorOptions;
  store[phone] = state;
  await saveSchedulerStore(store);
  return {
    ok: true,
    response: {
      reply_text: numberedList(`Especialidade ${selected.label} selecionada. Escolha um medico:`, [
        ...doctorOptions,
        { label: "Qualquer medico dessa especialidade" },
      ]),
      phase: state.phase,
    },
  };
}

async function schedulerStep(args: {
  baseUrl: string;
  apiKey?: string;
  phone: string;
  message: string;
}): Promise<JsonRecord> {
  const phone = cleanPhone(args.phone);
  const message = args.message.trim();
  const store = await loadSchedulerStore();
  let state = store[phone];

  // ── Cancel flow ──────────────────────────────────────────────────────────
  // Handle cancel phases even if there's an active booking state.
  if (state?.phase === "cancel_list") {
    if (state.phaseEnteredAt && Date.now() - state.phaseEnteredAt < 8000) {
      const opts = (state.cancelOptions ?? []).map((o, i) => ({ id: i + 1, label: o.label }));
      return { ok: false, response: { reply_text: numberedList("Qual consulta deseja cancelar?", opts), phase: state.phase } };
    }
    const opts = state.cancelOptions ?? [];
    let chosen = opts.length === 1 ? opts[0] : undefined;
    if (!chosen) {
      const idx = toInt(message.trim());
      if (idx !== undefined && idx >= 1 && idx <= opts.length) chosen = opts[idx - 1];
    }
    if (!chosen) {
      const listOpts = opts.map((o, i) => ({ id: i + 1, label: o.label }));
      return { ok: false, response: { reply_text: numberedList("Escolha a consulta pelo numero:", listOpts), phase: state.phase } };
    }
    state.selectedCancel = chosen;
    state.phase = "cancel_confirm";
    state.phaseEnteredAt = Date.now();
    store[phone] = state;
    await saveSchedulerStore(store);
    return {
      ok: true,
      response: {
        reply_text: `Confirma o cancelamento da consulta:\n${chosen.label}\n\nResponda *sim* para cancelar ou *nao* para manter.`,
        phase: state.phase,
      },
    };
  }

  if (state?.phase === "cancel_confirm") {
    if (state.phaseEnteredAt && Date.now() - state.phaseEnteredAt < 8000) {
      return { ok: false, response: { reply_text: `Confirma o cancelamento? Responda *sim* ou *nao*.`, phase: state.phase } };
    }
    const text = normalizeText(message);
    const confirmed = text === "sim" || text.startsWith("sim") || text === "s" || text === "yes";
    const denied = text === "nao" || text === "não" || text.startsWith("nao") || text === "n" || text === "no";
    if (!confirmed && !denied) {
      return { ok: false, response: { reply_text: "Responda *sim* para cancelar ou *nao* para manter a consulta.", phase: state.phase } };
    }
    if (denied) {
      delete store[phone];
      await saveSchedulerStore(store);
      return { ok: true, response: { reply_text: "Tudo bem! Sua consulta permanece agendada. Posso ajudar com mais alguma coisa?", phase: "done" } };
    }
    // Confirmed — cancel via API
    const apptId = state.selectedCancel?.id;
    if (!apptId) {
      delete store[phone];
      await saveSchedulerStore(store);
      return { ok: false, response: { reply_text: "Nao consegui identificar a consulta. Por favor, tente novamente.", phase: "done" } };
    }
    const cancelResp = await callBackend({
      baseUrl: args.baseUrl,
      apiKey: args.apiKey,
      method: "POST",
      path: "/hospital/appointments/cancel",
      body: { appointment_type: "consulta", appointment_id: apptId, status: "cancelada" },
    });
    const cancelOk = Number(cancelResp.http_status) >= 200 && Number(cancelResp.http_status) < 300;
    if (!cancelOk) {
      delete store[phone];
      await saveSchedulerStore(store);
      return { ok: false, response: { reply_text: "Nao foi possivel cancelar a consulta. Por favor, entre em contato com a recepção.", phase: "done" } };
    }
    // Success — ask about rescheduling
    const specialty = state.selectedCancel?.specialty;
    const specialtyId = state.selectedCancel?.specialty_id;
    state = { phase: "reschedule_prompt", phaseEnteredAt: Date.now(), specialty: specialtyId ? { id: specialtyId, label: specialty ?? "" } : undefined };
    store[phone] = state;
    await saveSchedulerStore(store);
    return {
      ok: true,
      response: {
        reply_text: `Consulta cancelada com sucesso! ✓\n\nDeseja reagendar${specialty ? ` uma consulta de ${specialty}` : ""}?\nResponda *sim* para reagendar ou *nao* para encerrar.`,
        phase: state.phase,
      },
    };
  }

  if (state?.phase === "reschedule_prompt") {
    if (state.phaseEnteredAt && Date.now() - state.phaseEnteredAt < 8000) {
      return { ok: false, response: { reply_text: "Deseja reagendar? Responda *sim* ou *nao*.", phase: state.phase } };
    }
    const text = normalizeText(message);
    const yes = text === "sim" || text.startsWith("sim") || text === "s";
    if (!yes) {
      delete store[phone];
      await saveSchedulerStore(store);
      return { ok: true, response: { reply_text: "Tudo bem! Até logo e cuide-se. 😊", phase: "done" } };
    }
    // Start new booking with specialty pre-selected if available
    const savedSpecialty = state.specialty;
    if (savedSpecialty?.id) {
      const newState: SchedulerState = { phase: "specialty" };
      store[phone] = newState;
      return promptDoctorChoice(args.baseUrl, args.apiKey, store, phone, newState, savedSpecialty);
    }
    // No specialty — show full specialty list
    const specialties = await listSpecialties(args.baseUrl, args.apiKey);
    const options = specialties.map((s) => ({ id: s.id, label: s.nome }));
    const newState: SchedulerState = { phase: "specialty", dateOptions: options };
    store[phone] = newState;
    await saveSchedulerStore(store);
    return { ok: true, response: { reply_text: numberedList("Otimo! Escolha a especialidade para o novo agendamento:", options), phase: "specialty" } };
  }

  // Detect cancel intent at any point (outside an active cancel flow)
  if (isCancelIntent(message)) {
    const apptResp = await callBackend({
      baseUrl: args.baseUrl,
      apiKey: args.apiKey,
      method: "GET",
      path: "/hospital/appointments/my",
      phone,
    });
    const appts = extractItemsArray(apptResp.response) as Array<Record<string, unknown>>;
    if (appts.length === 0) {
      delete store[phone];
      await saveSchedulerStore(store);
      return { ok: true, response: { reply_text: "Voce nao tem consultas agendadas no momento.", phase: "done" } };
    }

    const allOptions = appts.map((a) => ({
      id: Number(a.appointment_id),
      specialty: String(a.specialty_name ?? ""),
      specialty_id: toInt(a.specialty_id as LooseInt),
      doctor: String(a.doctor_name ?? ""),
      label: `${weekdayPt(String(a.data ?? ""))}, ${formatDatePt(String(a.data ?? ""))} ${normalizeTime(String(a.horario ?? ""))} — ${a.specialty_name ?? "Consulta"} com ${a.doctor_name ?? ""}`,
    }));

    // Try to narrow by specialty or doctor name mentioned in the message.
    const needle = normalizeText(message);
    let cancelOptions = allOptions.filter((o) => {
      const spec = normalizeText(o.specialty);
      const doc = normalizeText(o.doctor);
      return spec && (needle.includes(spec) || spec.split(" ").some((w) => w.length >= 4 && needle.includes(w))) ||
             doc && (needle.includes(doc) || doc.split(" ").some((w) => w.length >= 4 && needle.includes(w)));
    });
    // Fall back to full list if filter matched nothing
    if (cancelOptions.length === 0) cancelOptions = allOptions;

    const newState: SchedulerState = { phase: "cancel_list", cancelOptions, phaseEnteredAt: Date.now() };
    store[phone] = newState;

    // Single match — skip list, go straight to confirmation
    if (cancelOptions.length === 1) {
      const single = cancelOptions[0];
      newState.phase = "cancel_confirm";
      newState.selectedCancel = single;
      store[phone] = newState;
      await saveSchedulerStore(store);
      return {
        ok: true,
        response: {
          reply_text: `Encontrei uma consulta agendada:\n${single.label}\n\nConfirma o cancelamento? Responda *sim* para cancelar ou *nao* para manter.`,
          phase: "cancel_confirm",
        },
      };
    }

    // Multiple matches — show numbered list
    await saveSchedulerStore(store);
    const listOpts = cancelOptions.map((o, i) => ({ id: i + 1, label: o.label }));
    return { ok: true, response: { reply_text: numberedList("Qual consulta deseja cancelar?", listOpts), phase: "cancel_list" } };
  }
  // ── End cancel flow ───────────────────────────────────────────────────────

  const shouldRestart = !state || isResetIntent(message) || isNewBookingIntent(message);
  if (shouldRestart) {
    const specialties = await listSpecialties(args.baseUrl, args.apiKey);
    const options = specialties.map((s) => ({ id: s.id, label: s.nome }));
    const named = selectOptionByName(options, message);
    if (named?.id) {
      state = { phase: "specialty", dateOptions: options };
      store[phone] = state;
      return promptDoctorChoice(args.baseUrl, args.apiKey, store, phone, state, named);
    }
    state = { phase: "specialty", dateOptions: options };
    store[phone] = state;
    await saveSchedulerStore(store);
    return { ok: true, response: { reply_text: numberedList("Qual especialidade voce deseja agendar?", options), phase: state.phase } };
  }

  if (state.phase === "specialty") {
    const selected = selectOption(state.dateOptions, message);
    if (selected?.id) {
      return promptDoctorChoice(args.baseUrl, args.apiKey, store, phone, state, selected);
    }
    await saveSchedulerStore(store);
    return { ok: false, response: { reply_text: numberedList("Escolha uma especialidade pelo numero:", state.dateOptions ?? []), phase: state.phase } };
  }

  if (state.phase === "doctor") {
    const options = [...(state.dateOptions ?? []), { label: "Qualquer medico dessa especialidade" }];
    const selected = selectOption(options, message);
    if (!selected) {
      return { ok: false, response: { reply_text: numberedList("Escolha um medico pelo numero:", options), phase: state.phase } };
    }
    state.doctor = selected.id ? selected : null;
    state.phase = "period";
    store[phone] = state;
    await saveSchedulerStore(store);
    return { ok: true, response: { reply_text: periodReply(), phase: state.phase } };
  }

  if (state.phase === "period") {
    const period = normalizePeriod(message);
    if (!period) {
      return { ok: false, response: { reply_text: periodReply(), phase: state.phase } };
    }
    state.period = period;
    const week = await buildWeekSchedule(args.baseUrl, args.apiKey, {
      periodo: period,
      specialty_id: state.specialty?.id,
      doctor_id: state.doctor?.id,
    });
    const response = (week.response as Record<string, unknown>) ?? {};
    let items = (response.items as Array<{ date: string; weekday: string; slots: Array<JsonRecord> }> | undefined) ?? [];
    let windowInfo = response.window as Record<string, unknown> | undefined;
    let title = "Escolha uma data:";
    if (items.length === 0) {
      const nextWeek = response.next_week as
        | { window?: Record<string, unknown>; items?: Array<{ date: string; weekday: string; slots: Array<JsonRecord> }> }
        | undefined;
      if (nextWeek?.items && nextWeek.items.length > 0) {
        items = nextWeek.items;
        windowInfo = nextWeek.window;
        title = "Nao encontrei horarios nesta semana. Escolha uma data da proxima semana:";
      }
    }
    const options = dateOptionsFromWeekItems(items);
    if (options.length === 0) {
      state.phase = "period";
      state.dateOptions = []; // clear any stale date options from previous flows
      store[phone] = state;
      await saveSchedulerStore(store);
      return {
        ok: false,
        response: {
          reply_text: `Nao encontrei horarios para ${state.specialty?.label ?? "essa especialidade"} nesse periodo. Escolha outro periodo.\n1) Manha\n2) Tarde\n3) Noite`,
          phase: state.phase,
        },
      };
    }
    options.push({ value: "next_week", label: "Nenhuma dessas opcoes" });
    state.windowStart = String(windowInfo?.start_date ?? "");
    state.windowEnd = String(windowInfo?.end_date ?? "");
    state.dateOptions = options;
    state.phase = "date";
    store[phone] = state;
    await saveSchedulerStore(store);
    return { ok: true, response: { reply_text: numberedList(title, options), phase: state.phase } };
  }

  if (state.phase === "date") {
    const selected = selectOption(state.dateOptions, message);
    if (!selected) {
      return { ok: false, response: { reply_text: numberedList("Escolha uma data pelo numero:", state.dateOptions ?? []), phase: state.phase } };
    }
    if (selected.value === "next_week") {
      const nextStart = state.windowEnd ? asIsoDate(plusDays(new Date(`${state.windowEnd}T00:00:00`), 1)) : asIsoDate(plusDays(new Date(), 7));
      const week = await buildWeekSchedule(args.baseUrl, args.apiKey, {
        periodo: state.period,
        specialty_id: state.specialty?.id,
        doctor_id: state.doctor?.id,
        start_date: nextStart,
        days: 7,
      });
      const response = (week.response as Record<string, unknown>) ?? {};
      const items = (response.items as Array<{ date: string; weekday: string; slots: Array<JsonRecord> }> | undefined) ?? [];
      const options = dateOptionsFromWeekItems(items);
      if (options.length === 0) {
        state.phase = "period";
        store[phone] = state;
        await saveSchedulerStore(store);
        return {
          ok: false,
          response: {
            reply_text: "Nao encontrei mais datas para esse periodo. Escolha outro periodo.\n1) Manha\n2) Tarde\n3) Noite",
            phase: state.phase,
          },
        };
      }
      options.push({ value: "next_week", label: "Nenhuma dessas opcoes" });
      state.windowStart = String((response.window as Record<string, unknown> | undefined)?.start_date ?? nextStart);
      state.windowEnd = String((response.window as Record<string, unknown> | undefined)?.end_date ?? "");
      state.dateOptions = options;
      store[phone] = state;
      await saveSchedulerStore(store);
      return { ok: true, response: { reply_text: numberedList("Escolha uma data:", options), phase: state.phase } };
    }

    let slots = Array.isArray(selected.slots) ? selected.slots.filter((slot) => slotMatchesState(slot, state)) : [];
    if (slots.length === 0) {
      const slotsResp = await callBackend({
        baseUrl: args.baseUrl,
        apiKey: args.apiKey,
        method: "GET",
        path: "/hospital/calendar/slots",
        query: {
          data: selected.date,
          periodo: state.period,
          specialty_id: state.specialty?.id,
          doctor_id: state.doctor?.id,
        },
      });
      slots = extractItemsArray(slotsResp.response).filter((slot) => slotMatchesState(slot, state));
    }
    // Fallback: if the specific doctor has no slots in the selected period,
    // try fetching all their slots for that date (any period).
    if (slots.length === 0 && state.doctor?.id) {
      const fallbackResp = await callBackend({
        baseUrl: args.baseUrl,
        apiKey: args.apiKey,
        method: "GET",
        path: "/hospital/calendar/slots",
        query: {
          data: selected.date,
          specialty_id: state.specialty?.id,
          doctor_id: state.doctor?.id,
        },
      });
      slots = extractItemsArray(fallbackResp.response).filter((slot) => slotMatchesState(slot, state));
    }
    slots = filterPastTodaySlots(slots, selected.date ?? "");
    if (slots.length === 0) {
      state.phase = "date";
      store[phone] = state;
      await saveSchedulerStore(store);
      return {
        ok: false,
        response: {
          reply_text: numberedList("Esse dia nao tem mais horarios disponiveis. Escolha outra data:", state.dateOptions ?? []),
          phase: state.phase,
        },
      };
    }
    const slotDate = selected.date ?? toDateOnly(String(slots[0]?.data ?? ""));
    const slotOptions: SchedulerOption[] = slots.map((slot) => ({
      agenda_id: toInt(slot.agenda_id as LooseInt),
      date: toDateOnly(String(slot.data ?? slotDate ?? "")),
      label: schedulerSlotLabel(slot, !state.doctor),
    })).filter((slot) => slot.agenda_id !== undefined);
    state.slotOptions = slotOptions;
    state.slotPhaseEnteredAt = Date.now();
    state.phase = "slot";
    store[phone] = state;
    await saveSchedulerStore(store);
    return { ok: true, response: { reply_text: numberedList("Escolha um horario:", slotOptions), phase: state.phase } };
  }

  if (state.phase === "slot") {
    // Guard: if we just entered slot phase within the last 8 seconds, the model
    // may be auto-calling the tool before the patient has a chance to reply.
    // Re-send the slot list so the patient can actually choose.
    if (state.slotPhaseEnteredAt && Date.now() - state.slotPhaseEnteredAt < 8000) {
      return { ok: false, response: { reply_text: numberedList("Escolha um horario:", state.slotOptions ?? []), phase: state.phase } };
    }
    const selected = selectOption(state.slotOptions, message);
    if (!selected?.agenda_id) {
      return { ok: false, response: { reply_text: numberedList("Escolha um horario pelo numero:", state.slotOptions ?? []), phase: state.phase } };
    }
    state.selectedSlot = {
      ...selected,
      date: selected.date,
      label: appointmentLabel(selected.date, selected.label),
    };
    // Always fetch the existing patient but always re-collect data to avoid
    // using fabricated or stale records from previous sessions.
    state.patient = await getPatientByPhone(args.baseUrl, args.apiKey, phone);
    state.patientDraft = {};
    state.phase = "patient_name";
    state.phaseEnteredAt = Date.now();
    store[phone] = state;
    await saveSchedulerStore(store);
    return {
      ok: true,
      response: {
        reply_text: `Voce escolheu ${state.selectedSlot.label}. Qual e seu nome completo?`,
        phase: state.phase,
      },
    };
  }

  if (state.phase === "patient_name") {
    // Guard: model must not auto-answer this question.
    if (state.phaseEnteredAt && Date.now() - state.phaseEnteredAt < 8000) {
      return { ok: false, response: { reply_text: "Qual e seu nome completo?", phase: state.phase } };
    }
    if (!isPlausiblePersonName(message)) {
      return { ok: false, response: { reply_text: "Informe seu nome completo, por favor. Exemplo: Maria Silva Santos.", phase: state.phase } };
    }
    state.patientDraft = { ...(state.patientDraft ?? {}), nome_completo: message };
    state.phase = "patient_cpf";
    state.phaseEnteredAt = Date.now();
    store[phone] = state;
    await saveSchedulerStore(store);
    return { ok: true, response: { reply_text: "Qual e seu CPF? Envie somente os 11 numeros.", phase: state.phase } };
  }

  if (state.phase === "patient_cpf") {
    if (state.phaseEnteredAt && Date.now() - state.phaseEnteredAt < 8000) {
      return { ok: false, response: { reply_text: "Qual e seu CPF? Envie somente os 11 numeros.", phase: state.phase } };
    }
    const cpf = message.replace(/\D/g, "");
    if (cpf.length !== 11) {
      return { ok: false, response: { reply_text: "Informe seu CPF com 11 digitos. Exemplo: 12345678900.", phase: state.phase } };
    }
    state.patientDraft = { ...(state.patientDraft ?? {}), cpf };
    state.phase = "patient_birth";
    state.phaseEnteredAt = Date.now();
    store[phone] = state;
    await saveSchedulerStore(store);
    return { ok: true, response: { reply_text: "Qual e sua data de nascimento? Envie no formato AAAA-MM-DD. Exemplo: 1990-05-20.", phase: state.phase } };
  }

  if (state.phase === "patient_birth") {
    if (state.phaseEnteredAt && Date.now() - state.phaseEnteredAt < 8000) {
      return { ok: false, response: { reply_text: "Qual e sua data de nascimento? Envie no formato AAAA-MM-DD. Exemplo: 1990-05-20.", phase: state.phase } };
    }
    if (!isIsoDate(message)) {
      return { ok: false, response: { reply_text: "Envie a data de nascimento no formato AAAA-MM-DD. Exemplo: 1990-05-20.", phase: state.phase } };
    }
    state.patientDraft = { ...(state.patientDraft ?? {}), data_nascimento: message };
    state.phase = "patient_email";
    state.phaseEnteredAt = Date.now();
    store[phone] = state;
    await saveSchedulerStore(store);
    return { ok: true, response: { reply_text: "Qual e seu email? Se nao tiver, responda \"nao tenho\".", phase: state.phase } };
  }

  if (state.phase === "patient_email") {
    if (state.phaseEnteredAt && Date.now() - state.phaseEnteredAt < 8000) {
      return { ok: false, response: { reply_text: "Qual e seu email? Se nao tiver, responda \"nao tenho\".", phase: state.phase } };
    }
    const noEmail = ["nao tenho", "não tenho", "nao", "não"].includes(normalizeText(message));
    state.patientDraft = { ...(state.patientDraft ?? {}), email: noEmail ? null : message };
    state.phase = "payment";
    state.phaseEnteredAt = Date.now();
    store[phone] = state;
    await saveSchedulerStore(store);
    return { ok: true, response: { reply_text: "Como deseja pagar?\n1) Particular\n2) Convenio\nResponda com o numero da opcao.", phase: state.phase } };
  }

  if (state.phase === "payment") {
    if (state.phaseEnteredAt && Date.now() - state.phaseEnteredAt < 8000) {
      return { ok: false, response: { reply_text: "Como deseja pagar?\n1) Particular\n2) Convenio\nResponda com o numero da opcao.", phase: state.phase } };
    }
    const text = normalizeText(message);
    if (text === "1" || text.includes("particular")) {
      state.patientDraft = { ...(state.patientDraft ?? {}), payment_mode: "particular" };
      const result = await finishSchedulerBooking(args.baseUrl, args.apiKey, phone, state);
      if (result.done) delete store[phone];
      else store[phone] = state;
      await saveSchedulerStore(store);
      return { ok: result.done, response: { reply_text: result.reply_text, phase: result.done ? "done" : state.phase } };
    }
    if (text === "2" || text.includes("convenio")) {
      const out = await callBackend({ baseUrl: args.baseUrl, apiKey: args.apiKey, method: "GET", path: "/hospital/insurance/options" });
      const options = extractItemsArray(out.response).map((x) => ({ label: String(x.nome ?? ""), value: String(x.nome ?? "") }));
      state.insuranceOptions = options;
      state.patientDraft = { ...(state.patientDraft ?? {}), payment_mode: "convenio" };
      state.phase = "insurance_plan";
      store[phone] = state;
      await saveSchedulerStore(store);
      return { ok: true, response: { reply_text: numberedList("Qual convenio?", options), phase: state.phase } };
    }
    return { ok: false, response: { reply_text: "Como deseja pagar?\n1) Particular\n2) Convenio\nResponda com o numero da opcao.", phase: state.phase } };
  }

  if (state.phase === "insurance_plan") {
    const selected = selectOption(state.insuranceOptions, message) ?? { label: message, value: message };
    state.patientDraft = { ...(state.patientDraft ?? {}), insurance_name: selected.value ?? selected.label };
    state.phase = "insurance_card";
    store[phone] = state;
    await saveSchedulerStore(store);
    return { ok: true, response: { reply_text: "Qual e o numero da carteirinha do convenio?", phase: state.phase } };
  }

  if (state.phase === "insurance_card") {
    state.patientDraft = { ...(state.patientDraft ?? {}), carteirinha_id: message };
    state.phase = "insurance_expiration";
    store[phone] = state;
    await saveSchedulerStore(store);
    return { ok: true, response: { reply_text: "Qual a data de validade da carteirinha? Envie AAAA-MM-DD ou responda nao sei.", phase: state.phase } };
  }

  if (state.phase === "insurance_expiration") {
    const unknown = ["nao sei", "não sei", "nao", "não"].includes(normalizeText(message));
    if (!unknown && !isIsoDate(message)) {
      return { ok: false, response: { reply_text: "Envie a validade no formato AAAA-MM-DD ou responda nao sei.", phase: state.phase } };
    }
    state.patientDraft = { ...(state.patientDraft ?? {}), data_de_expiracao: unknown ? null : message };
    const result = await finishSchedulerBooking(args.baseUrl, args.apiKey, phone, state);
    if (result.done) delete store[phone];
    else store[phone] = state;
    await saveSchedulerStore(store);
    return { ok: result.done, response: { reply_text: result.reply_text, phase: result.done ? "done" : state.phase } };
  }

  delete store[phone];
  await saveSchedulerStore(store);
  return { ok: false, response: { reply_text: "Vamos recomecar. Qual especialidade voce deseja agendar?", phase: "reset" } };
}

export default defineToolPlugin({
  id: "telemed-fastapi-tools",
  name: "Telemed Fastapi Tools",
  description: "Hospital tools that call the existing TeleMed FastAPI endpoints.",
  configSchema: Type.Object(
    {
      baseUrl: Type.Optional(
        Type.String({
          description: "FastAPI base URL, e.g. http://127.0.0.1:8000",
        }),
      ),
      apiKey: Type.Optional(
        Type.String({
          description: "Optional API key for X-API-Key header.",
        }),
      ),
    },
    { additionalProperties: false },
  ),
  tools: (tool) => [
    tool({
      name: "hospital_scheduler_step",
      description:
        "Deterministic WhatsApp consultation scheduling state machine. Call this exactly once per patient message with the text exactly as received. Return reply_text verbatim. Never invent or auto-select doctor, period, date, or time.",
      parameters: Type.Object({
        phone: Type.Optional(Type.String({ description: "WhatsApp sender phone in E.164 format, e.g. +5511999999999." })),
        sender_phone: Type.Optional(Type.String({ description: "WhatsApp sender phone in E.164 format." })),
        whatsapp_phone: Type.Optional(Type.String({ description: "WhatsApp sender phone in E.164 format." })),
        message: Type.Optional(Type.String({ description: "Latest patient message exactly as received, including specialty names." })),
        latest_message: Type.Optional(Type.String({ description: "Alias for message; latest patient message exactly as received." })),
      }),
      execute: async (params, config) => {
        const phone = params.phone ?? params.sender_phone ?? params.whatsapp_phone;
        const message = params.message ?? params.latest_message;
        if (!phone) {
          return {
            ok: false,
            response: {
              reply_text: "Nao consegui identificar seu WhatsApp. Envie uma nova mensagem para reiniciar o agendamento.",
              reason: "missing_sender_phone",
            },
          };
        }
        if (!message) {
          return {
            ok: false,
            response: {
              reply_text: "Nao consegui ler sua mensagem. Pode enviar novamente?",
              reason: "missing_message",
            },
          };
        }
        return schedulerStep({
          baseUrl: config.baseUrl ?? "http://127.0.0.1:8000",
          apiKey: config.apiKey,
          phone,
          message,
        });
      },
    }),
    tool({
      name: "hospital_get_patient_by_phone",
      description: "Get patient info by WhatsApp phone.",
      parameters: Type.Object({
        phone: Type.String({ description: "Phone number in E.164 format." }),
      }),
      execute: async ({ phone }, config) =>
        callBackend({
          baseUrl: config.baseUrl ?? "http://127.0.0.1:8000",
          apiKey: config.apiKey,
          method: "GET",
          path: `/hospital/patients/by-phone/${encodeURIComponent(phone)}`,
        }),
    }),
    tool({
      name: "hospital_create_or_update_insurance",
      description: "Create or update insurance (convenio).",
      parameters: Type.Object({
        carteirinha_id: Type.String(),
        nome: Type.String(),
        data_de_expiracao: Type.Optional(Type.String({ format: "date" })),
      }),
      execute: async (params, config) =>
        callBackend({
          baseUrl: config.baseUrl ?? "http://127.0.0.1:8000",
          apiKey: config.apiKey,
          method: "POST",
          path: "/hospital/insurance",
          body: params,
        }),
    }),
    tool({
      name: "hospital_list_insurance_options",
      description: "List insurance options to show in WhatsApp list/buttons.",
      parameters: Type.Object({
        query: Type.Optional(Type.String()),
      }),
      execute: async (_params, config) => {
        const out = await callBackend({
          baseUrl: config.baseUrl ?? "http://127.0.0.1:8000",
          apiKey: config.apiKey,
          method: "GET",
          path: "/hospital/insurance/options",
        });
        if (out.http_status === 200) {
          const items = extractItemsArray(out.response);
          out.response = {
            reply_text: [
              "Qual especialidade voce deseja agendar?",
              ...items.slice(0, 30).map((x, i) => `${i + 1}) ${String(x.nome ?? "")}`),
            ].join("\n"),
            ...(out.response as Record<string, unknown>),
            choices: items.slice(0, 30).map((x, i) => ({
              option_id: `insurance:${i + 1}`,
              value: String(x.nome ?? ""),
              label: String(x.nome ?? ""),
            })),
          };
        }
        return out;
      },
    }),
    tool({
      name: "hospital_create_patient",
      description: "Create patient using WhatsApp phone in header.",
      parameters: Type.Object({
        phone: Type.String({ description: "WhatsApp sender phone." }),
        nome_completo: Type.String(),
        cpf: Type.String(),
        data_nascimento: Type.String({ format: "date" }),
        email: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        carteirinha_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      }),
      execute: async ({ phone, ...body }, config) =>
        callBackend({
          baseUrl: config.baseUrl ?? "http://127.0.0.1:8000",
          apiKey: config.apiKey,
          method: "POST",
          path: "/hospital/patients",
          phone,
          body,
        }),
    }),
    tool({
      name: "hospital_list_specialties",
      description: "List available specialties.",
      // Allow harmless LLM-added keys (for example "query") and ignore them.
      parameters: Type.Object({
        query: Type.Optional(Type.String()),
      }),
      execute: async (_params, config) => {
        const out = await callBackend({
          baseUrl: config.baseUrl ?? "http://127.0.0.1:8000",
          apiKey: config.apiKey,
          method: "GET",
          path: "/hospital/calendar/specialties",
        });
        if (out.http_status === 200) {
          const items = extractItemsArray(out.response);
          out.response = {
            ...(out.response as Record<string, unknown>),
            choices: items.slice(0, 30).map((x, i) => ({
              option_id: `specialty:${x.id ?? i + 1}`,
              value: i + 1,
              specialty_id: x.id ?? null,
              label: `${i + 1}) ${String(x.nome ?? "")}`,
            })),
          };
        }
        return out;
      },
    }),
    tool({
      name: "hospital_list_doctors",
      description: "List doctors, optionally by specialty.",
      parameters: Type.Object({
        specialty_id: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        specialty_name: Type.Optional(Type.String()),
        specialty: Type.Optional(Type.Union([Type.Number(), Type.String()])),
      }),
      execute: async (params, config) => {
        const baseUrl = config.baseUrl ?? "http://127.0.0.1:8000";
        const raw = normalizeToolParams(params);
        const resolvedSpecialtyId = await resolveSpecialtyId(
          baseUrl,
          config.apiKey,
          resolveSpecialtyInput(raw),
        );
        if (resolvedSpecialtyId === undefined) {
          const specialties = await listSpecialties(baseUrl, config.apiKey);
          return {
            http_status: 200,
            response: {
              ok: false,
              reason: "missing_specialty",
              reply_text: [
                "Qual especialidade voce deseja agendar?",
                ...specialties.slice(0, 30).map((s, i) => `${i + 1}) ${s.nome}`),
              ].join("\n"),
              message: "Especialidade obrigatoria para listar medicos. Peça para selecionar a especialidade primeiro.",
              choices: specialties.slice(0, 30).map((s, i) => ({
                option_id: `specialty:${s.id}`,
                value: i + 1,
                specialty_id: s.id,
                label: `${i + 1}) ${s.nome}`,
              })),
            },
          };
        }
        const out = await callBackend({
          baseUrl,
          apiKey: config.apiKey,
          method: "GET",
          path: "/hospital/calendar/doctors",
          query: { specialty_id: resolvedSpecialtyId },
        });
        if (out.http_status === 200) {
          const items = extractItemsArray(out.response);
          const specialtyName = String(items[0]?.especialidade_nome ?? "selecionada");
          out.response = {
            reply_text: [
              `Especialidade ${specialtyName} selecionada. Escolha um medico:`,
              ...items.slice(0, 30).map((x, i) => `${i + 1}) ${String(x.nome ?? "")}`),
            ].join("\n"),
            ...(out.response as Record<string, unknown>),
            choices: items.slice(0, 30).map((x, i) => ({
              option_id: `doctor:${x.id ?? i + 1}`,
              value: i + 1,
              doctor_id: x.id ?? null,
              label: `${i + 1}) ${String(x.nome ?? "")}`,
            })),
          };
        }
        return out;
      },
    }),
    tool({
      name: "hospital_list_doctor_shifts",
      description: "Alias for weekly schedule by specialty/doctor/period.",
      parameters: Type.Object({
        periodo: Type.Optional(periodSchema),
        period: Type.Optional(Type.String()),
        specialty_id: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        specialty_name: Type.Optional(Type.String()),
        specialty: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        doctor_id: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        doctor_name: Type.Optional(Type.String()),
        doctor: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        start_date: Type.Optional(Type.String({ format: "date" })),
        end_date: Type.Optional(Type.String({ format: "date" })),
        days: Type.Optional(Type.Number({ minimum: 1, maximum: 14 })),
      }),
      execute: async (params, config) => {
        const raw = normalizeToolParams(params);
        const periodInput = pickString(raw, ["periodo", "period", "shift", "turno"]);
        return buildWeekSchedule(config.baseUrl ?? "http://127.0.0.1:8000", config.apiKey, {
          periodo: normalizePeriod(periodInput),
          specialty_id: resolveSpecialtyInput(raw),
          doctor_id: resolveDoctorInput(raw),
          start_date: pickString(raw, ["start_date"]),
          end_date: pickString(raw, ["end_date"]),
          days: typeof raw.days === "number" ? raw.days : undefined,
        });
      },
    }),
    tool({
      name: "hospital_list_shifts",
      description: "Compatibility alias for weekly schedule with shift selection.",
      parameters: Type.Object({
        periodo: Type.Optional(periodSchema),
        period: Type.Optional(Type.String()),
        shift: Type.Optional(Type.String()),
        specialty_id: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        specialty_name: Type.Optional(Type.String()),
        specialty: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        doctor_id: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        doctor_name: Type.Optional(Type.String()),
        doctor: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        start_date: Type.Optional(Type.String({ format: "date" })),
        end_date: Type.Optional(Type.String({ format: "date" })),
        days: Type.Optional(Type.Number({ minimum: 1, maximum: 14 })),
      }),
      execute: async (params, config) => {
        const raw = normalizeToolParams(params);
        return buildWeekSchedule(config.baseUrl ?? "http://127.0.0.1:8000", config.apiKey, {
          periodo: pickString(raw, ["periodo", "period", "shift", "turno"]),
          specialty_id: resolveSpecialtyInput(raw),
          doctor_id: resolveDoctorInput(raw),
          start_date: pickString(raw, ["start_date"]),
          end_date: pickString(raw, ["end_date"]),
          days: typeof raw.days === "number" ? raw.days : undefined,
        });
      },
    }),
    tool({
      name: "hospital_list_available_dates",
      description: "List available dates for booking filtered by optional inputs.",
      parameters: Type.Object({
        periodo: Type.Optional(periodSchema),
        period: Type.Optional(Type.String()),
        shift: Type.Optional(Type.String()),
        specialty_id: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        specialty_name: Type.Optional(Type.String()),
        specialty: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        doctor_id: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        doctor_name: Type.Optional(Type.String()),
        doctor: Type.Optional(Type.Union([Type.Number(), Type.String()])),
      }),
      execute: async (params, config) => {
        const baseUrl = config.baseUrl ?? "http://127.0.0.1:8000";
        const raw = normalizeToolParams(params);
        const periodInput = pickString(raw, ["periodo", "period", "shift", "turno"]);
        const resolvedSpecialtyId = await resolveSpecialtyId(
          baseUrl,
          config.apiKey,
          resolveSpecialtyInput(raw),
        );
        const resolvedDoctorId = await resolveDoctorId(
          baseUrl,
          config.apiKey,
          resolveDoctorInput(raw),
          resolvedSpecialtyId,
        );
        const normalizedPeriod = normalizePeriod(periodInput);
        if (!normalizedPeriod) {
          return {
            http_status: 200,
            response: {
              ok: false,
              reason: "missing_period",
              reply_text: "Qual periodo voce prefere?\n1) Manha\n2) Tarde\n3) Noite",
              message: "Periodo obrigatorio. Peça para escolher: manha, tarde ou noite.",
              choices: [
                { option_id: "period:morning", value: "morning", label: "Manha" },
                { option_id: "period:afternoon", value: "afternoon", label: "Tarde" },
                { option_id: "period:evening", value: "evening", label: "Noite" },
              ],
            },
          };
        }
        const withDateChoices = (rawOut: JsonRecord): JsonRecord => {
          const items = extractItemsArray(rawOut.response).map((x) => ({
            ...x,
            data: toDateOnly(String(x.data ?? "")) ?? String(x.data ?? ""),
          }));
          return {
            ...rawOut,
            response: {
              ...(rawOut.response as Record<string, unknown>),
              items,
              total: items.length,
              choices: [
                ...items.slice(0, 30).map((x, i) => {
                  const d = String(x.data ?? "");
                  return {
                    option_id: `date:${d || i + 1}`,
                    value: d || null,
                    label: d ? `${weekdayPt(d)}, ${d}` : String(x.data ?? ""),
                  };
                }),
                {
                  option_id: "none:next_week",
                  value: null,
                  label: "Nenhuma dessas opcoes (proxima semana)",
                },
              ],
            },
          };
        };

        const primary = await callBackend({
          baseUrl,
          apiKey: config.apiKey,
          method: "GET",
          path: "/hospital/calendar/dates",
          query: {
            periodo: normalizedPeriod,
            specialty_id: resolvedSpecialtyId,
            doctor_id: resolvedDoctorId,
          },
        });

        // Some datasets label "tarde" availability as "evening".
        if (primary.http_status === 200 && normalizedPeriod === "afternoon") {
          const total = extractTotal(primary.response);
          if (total === 0) {
            const fallback = await callBackend({
              baseUrl,
              apiKey: config.apiKey,
              method: "GET",
              path: "/hospital/calendar/dates",
              query: {
                periodo: "evening",
                specialty_id: resolvedSpecialtyId,
                doctor_id: resolvedDoctorId,
              },
            });
            return fallback.http_status === 200 ? withDateChoices(fallback) : fallback;
          }
        }

        return primary.http_status === 200 ? withDateChoices(primary) : primary;
      },
    }),
    tool({
      name: "hospital_list_available_slots",
      description: "List available slots for a selected date and optional filters.",
      parameters: Type.Object({
        data: Type.Optional(Type.String({ format: "date" })),
        date: Type.Optional(Type.String({ format: "date" })),
        periodo: Type.Optional(periodSchema),
        period: Type.Optional(Type.String()),
        shift: Type.Optional(Type.String()),
        specialty_id: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        specialty_name: Type.Optional(Type.String()),
        specialty: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        doctor_id: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        doctor_name: Type.Optional(Type.String()),
        doctor: Type.Optional(Type.Union([Type.Number(), Type.String()])),
      }),
      execute: async (params, config) => {
        const baseUrl = config.baseUrl ?? "http://127.0.0.1:8000";
        const raw = normalizeToolParams(params);
        const dateInput = pickString(raw, ["data", "date", "dia"]);
        const periodInput = pickString(raw, ["periodo", "period", "shift", "turno"]);
        const resolvedSpecialtyId = await resolveSpecialtyId(
          baseUrl,
          config.apiKey,
          resolveSpecialtyInput(raw),
        );
        const resolvedDoctorId = await resolveDoctorId(
          baseUrl,
          config.apiKey,
          resolveDoctorInput(raw),
          resolvedSpecialtyId,
        );
        const normalizedPeriod = normalizePeriod(periodInput);

        // If the model calls slots too early (without date), return date options instead.
        if (!dateInput) {
          const week = await buildWeekSchedule(baseUrl, config.apiKey, {
            periodo: normalizedPeriod,
            specialty_id: resolvedSpecialtyId,
            doctor_id: resolvedDoctorId,
          });
          return {
            http_status: 200,
            response: {
              ok: false,
              reason: "date_required",
              message: "Selecione primeiro uma data na lista semanal.",
              week_options: week.response,
            },
          };
        }

        const primary = await callBackend({
          baseUrl,
          apiKey: config.apiKey,
          method: "GET",
          path: "/hospital/calendar/slots",
          query: {
            data: dateInput,
            periodo: normalizedPeriod,
            specialty_id: resolvedSpecialtyId,
            doctor_id: resolvedDoctorId,
          },
        });

        if (primary.http_status === 200) {
          const payload = (primary.response as { items?: Array<Record<string, unknown>> } | null) ?? {};
          const items = (payload.items ?? []).map((s) => ({
            ...s,
            horario: normalizeTime(s.horario),
          }));
          const filtered = filterPastTodaySlots(items, dateInput);
          const weekday = weekdayPt(dateInput);
          primary.response = {
            ...(payload as Record<string, unknown>),
            items: filtered,
            total: filtered.length,
            choices: filtered.slice(0, 30).map((xRaw, i) => {
              const x = xRaw as Record<string, unknown>;
              return {
                option_id: `agenda:${toInt(x.agenda_id as LooseInt) ?? i + 1}`,
                value: toInt(x.agenda_id as LooseInt) ?? null,
              label: slotLabelPt({
                date: dateInput,
                weekday,
                horario: normalizeTime(x.horario),
                doctorName: typeof x.doctor_name === "string" ? x.doctor_name : undefined,
                periodo: typeof x.periodo === "string" ? x.periodo : undefined,
              }),
              };
            }).concat([
              {
                option_id: "none:next_week",
                value: null,
                label: "Nenhuma dessas opcoes (proxima semana)",
              },
            ]),
          };
          if (filtered.length === 0) {
            const alternatives = await buildWeekSchedule(baseUrl, config.apiKey, {
              periodo: normalizedPeriod,
              specialty_id: resolvedSpecialtyId,
              doctor_id: resolvedDoctorId,
            });
            primary.response = {
              ...(primary.response as Record<string, unknown>),
              message:
                "Sem vagas para esta data. Consulte as alternativas em alternatives_week e, se preciso, em alternatives_week.next_week.",
              alternatives_week: (alternatives.response as Record<string, unknown>) ?? null,
            };
          }
        }

        if (primary.http_status === 200 && normalizedPeriod === "afternoon") {
          const total = extractTotal(primary.response);
          if (total === 0) {
            const fallback = await callBackend({
              baseUrl,
              apiKey: config.apiKey,
              method: "GET",
              path: "/hospital/calendar/slots",
              query: {
                data: dateInput,
                periodo: "evening",
                specialty_id: resolvedSpecialtyId,
                doctor_id: resolvedDoctorId,
              },
            });
            if (fallback.http_status === 200) {
              const payload = (fallback.response as { items?: Array<Record<string, unknown>> } | null) ?? {};
              const items = (payload.items ?? []).map((s) => ({
                ...s,
                horario: normalizeTime(s.horario),
              }));
              const filtered = filterPastTodaySlots(items, dateInput);
              fallback.response = {
                ...(payload as Record<string, unknown>),
                items: filtered,
                total: filtered.length,
                choices: filtered.slice(0, 30).map((xRaw, i) => {
                  const x = xRaw as Record<string, unknown>;
                  return {
                    option_id: `agenda:${toInt(x.agenda_id as LooseInt) ?? i + 1}`,
                    value: toInt(x.agenda_id as LooseInt) ?? null,
                    label: slotLabelPt({
                      date: dateInput,
                      weekday: weekdayPt(dateInput),
                      horario: normalizeTime(x.horario),
                      doctorName: typeof x.doctor_name === "string" ? x.doctor_name : undefined,
                      periodo: typeof x.periodo === "string" ? x.periodo : undefined,
                    }),
                  };
                }).concat([
                  {
                    option_id: "none:next_week",
                    value: null,
                    label: "Nenhuma dessas opcoes (proxima semana)",
                  },
                ]),
              };
            }
            return fallback;
          }
        }

        return primary;
      },
    }),
    tool({
      name: "hospital_list_week_schedule",
      description:
        "List schedule options for a week window (today + next days by default), grouped by date, with doctor and time.",
      parameters: Type.Object({
        periodo: Type.Optional(periodSchema),
        period: Type.Optional(Type.String()),
        shift: Type.Optional(Type.String()),
        specialty_id: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        specialty_name: Type.Optional(Type.String()),
        specialty: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        doctor_id: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        doctor_name: Type.Optional(Type.String()),
        doctor: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        start_date: Type.Optional(Type.String({ format: "date" })),
        end_date: Type.Optional(Type.String({ format: "date" })),
        days: Type.Optional(Type.Number({ minimum: 1, maximum: 14 })),
      }),
      execute: async (params, config) => {
        const raw = normalizeToolParams(params);
        return buildWeekSchedule(config.baseUrl ?? "http://127.0.0.1:8000", config.apiKey, {
          periodo: pickString(raw, ["periodo", "period", "shift", "turno"]),
          specialty_id: pickLooseInt(raw, ["specialty_id", "specialty"]),
          specialty_name: pickString(raw, ["specialty_name", "specialty", "especialidade"]),
          doctor_id: pickLooseInt(raw, ["doctor_id", "doctor"]),
          doctor_name: pickString(raw, ["doctor_name", "doctor", "medico", "médico"]),
          start_date: pickString(raw, ["start_date"]),
          end_date: pickString(raw, ["end_date"]),
          days: typeof raw.days === "number" ? raw.days : undefined,
        });
      },
    }),
    tool({
      name: "hospital_create_appointment",
      description: "Create a consultation or exam appointment.",
      parameters: Type.Object({
        appointment_type: Type.Optional(Type.Union([Type.Literal("consulta"), Type.Literal("exame")])),
        appointmentType: Type.Optional(Type.String()),
        patient_id: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        patient_phone: Type.Optional(Type.String()),
        phone: Type.Optional(Type.String()),
        agenda_id: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        date: Type.Optional(Type.String()),
        data: Type.Optional(Type.String()),
        period: Type.Optional(Type.String()),
        periodo: Type.Optional(Type.String()),
        time: Type.Optional(Type.String()),
        specialty_id: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        specialty_name: Type.Optional(Type.String()),
        specialty: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        doctor_id: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        doctor_name: Type.Optional(Type.String()),
        doctor: Type.Optional(Type.Union([Type.Number(), Type.String()])),
        status: Type.Optional(Type.String()),
      }),
      execute: async (params, config) => {
        const baseUrl = config.baseUrl ?? "http://127.0.0.1:8000";
        const raw = normalizeToolParams(params);
        const appointmentTypeRaw = pickString(raw, ["appointment_type", "appointmentType"]);
        const appointmentType =
          appointmentTypeRaw === "exame" || appointmentTypeRaw === "consulta" ? appointmentTypeRaw : "consulta";
        const status = pickString(raw, ["status"]) ?? "agendada";

        let patientId = toInt(pickLooseInt(raw, ["patient_id"]));
        let agendaId = toInt(pickLooseInt(raw, ["agenda_id"]));
        let patientProfileMissing: string[] = [];

        // Try resolve patient_id from phone if provided.
        if (patientId === undefined) {
          const phone = pickString(raw, ["patient_phone", "phone"]);
          if (phone) {
            const patientResp = await callBackend({
              baseUrl,
              apiKey: config.apiKey,
              method: "GET",
              path: `/hospital/patients/by-phone/${encodeURIComponent(phone)}`,
            });
            const found = (patientResp.response as { found?: boolean; patient?: { id?: unknown } } | null)?.found;
            const idCandidate = (patientResp.response as { patient?: { id?: unknown } } | null)?.patient?.id;
            if (found) {
              patientId = toInt(idCandidate as LooseInt);
              const patient = (patientResp.response as { patient?: Record<string, unknown> } | null)?.patient ?? {};
              if (!String(patient.nome_completo ?? "").trim()) patientProfileMissing.push("nome_completo");
              if (!String(patient.cpf ?? "").trim()) patientProfileMissing.push("cpf");
              if (!String(patient.data_nascimento ?? "").trim()) patientProfileMissing.push("data_nascimento");
            }
          }
        }

        // Try resolve agenda_id from exact date + filters when missing.
        if (agendaId === undefined) {
          const dateInput = pickString(raw, ["date", "data", "dia"]);
          if (isIsoDate(dateInput)) {
            const periodInput = pickString(raw, ["periodo", "period", "time", "turno"]);
            const specialtyId = await resolveSpecialtyId(
              baseUrl,
              config.apiKey,
              resolveSpecialtyInput(raw),
            );
            const doctorId = await resolveDoctorId(
              baseUrl,
              config.apiKey,
              resolveDoctorInput(raw),
              specialtyId,
            );

            const slotsResp = await callBackend({
              baseUrl,
              apiKey: config.apiKey,
              method: "GET",
              path: "/hospital/calendar/slots",
              query: {
                data: dateInput,
                periodo: normalizePeriod(periodInput),
                specialty_id: specialtyId,
                doctor_id: doctorId,
              },
            });
            const items =
              ((slotsResp.response as { items?: Array<{ agenda_id?: unknown }> } | null)?.items as
                | Array<{ agenda_id?: unknown }>
                | undefined) ?? [];
            if (items.length === 1) {
              agendaId = toInt(items[0].agenda_id as LooseInt);
            } else if (items.length > 1) {
              return {
                http_status: 200,
                response: {
                  ok: false,
                  reason: "ambiguous_agenda",
                  message:
                    "Mais de um horario disponivel para os filtros informados. Peça ao paciente para escolher um horario da lista.",
                  candidates: items.slice(0, 10),
                },
              };
            }
          }
        }

        if (patientId === undefined || agendaId === undefined || patientProfileMissing.length > 0) {
          const registrationRequired = patientId === undefined;
          const slotSelectionRequired = agendaId === undefined;
          const profileIncomplete = patientProfileMissing.length > 0;
          return {
            http_status: 200,
            response: {
              ok: false,
              reason: profileIncomplete
                ? "patient_profile_incomplete"
                : registrationRequired
                  ? "patient_not_registered"
                  : "slot_not_selected",
              registration_required: registrationRequired || profileIncomplete,
              slot_selection_required: slotSelectionRequired,
              missing_profile_fields: patientProfileMissing,
              message: profileIncomplete
                ? "Cadastro incompleto. Colete nome, CPF e data de nascimento antes de concluir."
                : registrationRequired
                  ? "Paciente ainda nao cadastrado. Colete os dados cadastrais e tente novamente."
                  : "Horario ainda nao selecionado. Mostre os horarios em lista e peça para escolher uma opcao.",
            },
          };
        }

        return callBackend({
          baseUrl,
          apiKey: config.apiKey,
          method: "POST",
          path: "/hospital/appointments",
          body: {
            appointment_type: appointmentType,
            patient_id: patientId,
            agenda_id: agendaId,
            status,
          },
        });
      },
    }),
    tool({
      name: "hospital_list_my_appointments",
      description: "List scheduled appointments for patient phone.",
      parameters: Type.Object({
        phone: Type.String({ description: "WhatsApp sender phone." }),
        appointment_type: Type.Optional(Type.Union([Type.Literal("consulta"), Type.Literal("exame")])),
      }),
      execute: async ({ phone, appointment_type }, config) =>
        callBackend({
          baseUrl: config.baseUrl ?? "http://127.0.0.1:8000",
          apiKey: config.apiKey,
          method: "GET",
          path: "/hospital/appointments/my",
          phone,
          query: { appointment_type: appointment_type ?? "consulta" },
        }),
    }),
    tool({
      name: "hospital_cancel_appointment",
      description: "Cancel a consultation or exam appointment.",
      parameters: Type.Object({
        appointment_type: Type.Union([Type.Literal("consulta"), Type.Literal("exame")]),
        appointment_id: Type.Union([Type.Number(), Type.String()]),
        status: Type.Optional(Type.String()),
      }),
      execute: async ({ appointment_type, appointment_id, status }, config) =>
        callBackend({
          baseUrl: config.baseUrl ?? "http://127.0.0.1:8000",
          apiKey: config.apiKey,
          method: "POST",
          path: "/hospital/appointments/cancel",
          body: {
            appointment_type,
            appointment_id: toInt(appointment_id),
            status: status ?? "cancelada",
          },
        }),
    }),
  ].filter((definedTool) => !INTERNAL_SCHEDULING_TOOL_NAMES.has(String((definedTool as { name?: unknown }).name))),
});
