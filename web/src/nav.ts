/**
 * Destinos do painel: fonte única da barra lateral (md para cima) e da barra de baixo (celular).
 * Sem React e sem ícones: o teste roda com node:test. Os ícones ficam em components/nav-icons.ts.
 */

/** Onde o destino fica na barra lateral: no topo, ou embaixo (Conexão e Agenda). */
export type NavPosition = "top" | "bottom";

/** Cada destino, na ordem da barra de baixo. `labelKey` é o nome completo; `shortKey` é o rótulo da célula de 1/6 da barra de baixo. */
export const NAV_ITEMS = [
  { view: "inbox", hash: "#/", labelKey: "nav.conversations", shortKey: "nav.short.chats", position: "top" },
  { view: "appointments", hash: "#/appointments", labelKey: "nav.appointments", shortKey: "nav.short.appointments", position: "top" },
  { view: "connection", hash: "#/connection", labelKey: "nav.connection", shortKey: "nav.short.whatsapp", position: "bottom" },
  { view: "calendar", hash: "#/calendar", labelKey: "nav.calendar", shortKey: "nav.short.calendar", position: "bottom" },
  { view: "customers", hash: "#/customers", labelKey: "nav.customers", shortKey: "nav.short.customers", position: "top" },
  { view: "knowledge", hash: "#/knowledge", labelKey: "nav.knowledge", shortKey: "nav.short.knowledge", position: "top" },
] as const;

export type View = (typeof NAV_ITEMS)[number]["view"];
export type NavItem = (typeof NAV_ITEMS)[number];

/** Hashes antigos (português) que continuam abrindo a mesma tela. */
const LEGACY_HASH_VIEWS: Readonly<Record<string, View>> = {
  "#/conexao": "connection",
  "#/agenda": "calendar",
  "#/clientes": "customers",
};

/** Tela para o hash da URL; ignora a query string e cai na caixa de entrada para hash desconhecido. */
export function viewFromHash(hash: string): View {
  const path = hash.split("?")[0];
  const item = NAV_ITEMS.find((candidate) => candidate.hash === path);
  if (item) return item.view;
  return LEGACY_HASH_VIEWS[path] ?? "inbox";
}

/** Destinos de uma posição da barra lateral, na ordem da barra de baixo. */
export function navItemsAt(position: NavPosition): NavItem[] {
  return NAV_ITEMS.filter((item) => item.position === position);
}

/** Destino da tela atual (usado no título da barra de cima). */
export function navItemFor(view: View): NavItem {
  return NAV_ITEMS.find((item) => item.view === view) ?? NAV_ITEMS[0];
}
