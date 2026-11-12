export type GreetingPeriod = "morning" | "afternoon" | "evening";

/** Saudação pelo horário: manhã antes das 12h, tarde antes das 18h, noite depois (hora do relógio da clínica). */
export function greetingKey(hour: number): GreetingPeriod {
  if (hour < 12) return "morning";
  return hour < 18 ? "afternoon" : "evening";
}
