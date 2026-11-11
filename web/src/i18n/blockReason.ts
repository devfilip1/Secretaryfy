import { useTranslation } from "react-i18next";

/**
 * Texto do motivo pelo qual a proteção do número não enviou ou o lembrete não saiu (specs/004 data-model.md, specs/006).
 * Um motivo desconhecido volta como veio do servidor. Compartilhado por Conversas e Agendamentos.
 */
export function useBlockReasonText(): (reason: string | null) => string {
  const { t } = useTranslation();
  return (reason) => (reason ? t(`blockReason.${reason}` as never, { defaultValue: reason }) : "");
}
