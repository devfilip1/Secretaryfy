import { z } from "zod";
import type { Language } from "../modules/scheduling/dates.js";

/** O idioma que o painel pede em `?language=` (en ou pt). */
const languageQuery = z.object({ language: z.enum(["en", "pt"]).optional() });

/**
 * O idioma dos rótulos da resposta: o pedido pelo painel ou, sem ele, o da clínica. Null se o valor não é en nem pt
 * (a rota responde 422). Vale para os serviços fixos (avaliação geral, retorno); os tratamentos mantêm o título da clínica.
 */
export function panelLanguage(query: unknown, clinicLanguage: Language): Language | null {
  const parsed = languageQuery.safeParse(query);
  return parsed.success ? (parsed.data.language ?? clinicLanguage) : null;
}
