import type { WeeklyHours } from "../db/schema.js";

/** Horário das duas clínicas de rag/data/source: segunda a sexta 9h às 18h, sábado 9h às 14h, domingo fechado. */
export const CLINIC_HOURS: WeeklyHours = {
  "1": { start: "09:00", end: "18:00" },
  "2": { start: "09:00", end: "18:00" },
  "3": { start: "09:00", end: "18:00" },
  "4": { start: "09:00", end: "18:00" },
  "5": { start: "09:00", end: "18:00" },
  "6": { start: "09:00", end: "14:00" },
};
