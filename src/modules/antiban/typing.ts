import type { AntibanConfig } from "./limits.js";

type Random = () => number;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Quanto tempo mostrar "digitando…" antes de uma resposta: cresce com o texto e varia a cada vez,
 * para nunca haver um ritmo fixo (research.md R3; FR-006, FR-008).
 */
export function typingDelay(text: string, config: Pick<AntibanConfig, "typingMinMs" | "typingMaxMs">, random: Random = Math.random) {
  const base = clamp(800 + 45 * text.length, config.typingMinMs, config.typingMaxMs);
  return Math.round(clamp(base * (0.8 + random() * 0.45), config.typingMinMs, config.typingMaxMs));
}

/**
 * Quanto tempo depois da última mensagem do cliente ela aparece como visualizada: a pessoa não está com o celular
 * na mão o tempo todo. Sorteado entre o mínimo e o máximo, puxando para o meio (FR-005a).
 */
export function readDelay(config: Pick<AntibanConfig, "readMinMs" | "readMaxMs">, random: Random = Math.random) {
  const r = (random() + random()) / 2;
  return Math.round(config.readMinMs + r * (config.readMaxMs - config.readMinMs));
}

/**
 * Pausa entre visualizar e começar a digitar: o tempo de ler o que o cliente escreveu e pensar na resposta.
 * Cresce com o tamanho da mensagem do cliente e varia a cada vez (FR-005b).
 */
export function thinkDelay(
  readText: string,
  config: Pick<AntibanConfig, "thinkMinMs" | "thinkMaxMs">,
  random: Random = Math.random,
) {
  const base = clamp(600 + 30 * readText.length, config.thinkMinMs, config.thinkMaxMs);
  return Math.round(clamp(base * (0.75 + random() * 0.5), config.thinkMinMs, config.thinkMaxMs));
}

/** Intervalo aleatório entre dois envios quaisquer do número (FR-010). */
export function gapDelay(config: Pick<AntibanConfig, "gapMinMs" | "gapMaxMs">, random: Random = Math.random) {
  return Math.round(config.gapMinMs + random() * (config.gapMaxMs - config.gapMinMs));
}
