import { BookOpen, Calendar, CalendarCheck, MessageSquare, Smartphone, Users, type LucideIcon } from "lucide-react";
import type { View } from "../nav";

/** Ícone de cada destino. Fica fora de nav.ts para que nav.ts não carregue React nos testes. */
export const NAV_ICONS: Record<View, LucideIcon> = {
  inbox: MessageSquare,
  appointments: CalendarCheck,
  connection: Smartphone,
  calendar: Calendar,
  customers: Users,
  knowledge: BookOpen,
};
