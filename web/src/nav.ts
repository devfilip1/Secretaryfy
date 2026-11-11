/**
 * Destinos do painel: fonte única da barra lateral (md para cima) e da barra de baixo (celular).
 * Sem React e sem ícones: o teste roda com node:test. Os ícones ficam em components/nav-icons.ts.
 */

/** Cada destino, na ordem da barra de baixo. `labelKey` é o nome completo; `shortKey` é o rótulo da célula de 1/6 da barra de baixo. */
export const NAV_ITEMS = [
  { view: "inbox", hash: "#/", labelKey: "nav.conversations", shortKey: "nav.short.chats", group: "service" },
  { view: "appointments", hash: "#/appointments", labelKey: "nav.appointments", shortKey: "nav.short.appointments", group: "service" },
  { view: "connection", hash: "#/connection", labelKey: "nav.connection", shortKey: "nav.short.whatsapp", group: "system" },
  { view: "calendar", hash: "#/calendar", labelKey: "nav.calendar", shortKey: "nav.short.calendar", group: "clinic" },
  { view: "customers", hash: "#/customers", labelKey: "nav.customers", shortKey: "nav.short.customers", group: "clinic" },
  { view: "knowledge", hash: "#/knowledge", labelKey: "nav.knowledge", shortKey: "nav.short.knowledge", group: "clinic" },
] as const;

/** Grupos da barra lateral, na ordem em que aparecem. `labelKey` é chave do common.json. */
export const NAV_GROUPS = [
  { id: "service", labelKey: "nav.groups.service" },
  { id: "clinic", labelKey: "nav.groups.clinic" },
  { id: "system", labelKey: "nav.groups.system" },
] as const;

export type View = (typeof NAV_ITEMS)[number]["view"];
export type NavItem = (typeof NAV_ITEMS)[number];
export type NavGroupId = (typeof NAV_GROUPS)[number]["id"];

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

/** Destinos de um grupo, na ordem da barra de baixo. */
export function navItemsIn(group: NavGroupId): NavItem[] {
  return NAV_ITEMS.filter((item) => item.group === group);
}

/** Destino da tela atual (usado na migalha da barra de cima). */
export function navItemFor(view: View): NavItem {
  return NAV_ITEMS.find((item) => item.view === view) ?? NAV_ITEMS[0];
}
