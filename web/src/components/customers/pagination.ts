/** Clientes por página na lista. */
export const PAGE_SIZE = 20;

export type PageSlice<T> = {
  items: T[];
  /** Página efetivamente mostrada, já ajustada ao intervalo válido. */
  page: number;
  pageCount: number;
  /** Primeiro e último item da página (1-based); 0 quando a lista está vazia. */
  from: number;
  to: number;
  total: number;
};

/** Número de páginas; uma lista vazia ainda tem a página 1. */
export function pageCountOf(total: number, pageSize = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Página pedida limitada ao intervalo válido (ex.: cliente excluído na última página). */
export function clampPage(page: number, total: number, pageSize = PAGE_SIZE): number {
  return Math.min(Math.max(1, page), pageCountOf(total, pageSize));
}

/** Fatia da lista para a página pedida, depois de clampada. */
export function paginate<T>(items: readonly T[], page: number, pageSize = PAGE_SIZE): PageSlice<T> {
  const total = items.length;
  const current = clampPage(page, total, pageSize);
  const start = (current - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  return {
    items: items.slice(start, end),
    page: current,
    pageCount: pageCountOf(total, pageSize),
    from: total === 0 ? 0 : start + 1,
    to: end,
    total,
  };
}
