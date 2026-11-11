import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/** Contraste mínimo de texto normal (WCAG 2.x, nível AA). */
const MIN_RATIO = 4.5;

/** Pares de texto e fundo que o painel usa; cada um é conferido nos dois modos. */
const PAIRS: readonly [text: string, background: string][] = [
  ["text", "bg"],
  ["text", "surface"],
  ["muted", "bg"],
  ["muted", "surface"],
  ["accent-text", "accent"],
  ["bad", "bg"],
  ["bad", "alert-bg"],
  ["ok", "surface"],
  ["warn", "bg"],
];

const CSS = readFileSync(fileURLToPath(new URL("../tailwind.css", import.meta.url)), "utf8");

/** Corpo do primeiro bloco que casa com o seletor dado. */
function blockOf(selector: RegExp): string {
  const match = selector.exec(CSS);
  assert.ok(match, `bloco ${selector} não achado em tailwind.css`);
  return match[1];
}

/** Valor hexadecimal de --name dentro de um bloco de variáveis. */
function tokenIn(block: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(block);
  assert.ok(match, `--${name} não definido no bloco`);
  return match[1];
}

/** Todas as variáveis de cor de um bloco, como mapa nome -> hex. */
function tokensOf(block: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const match of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens.set(match[1], match[2]);
  }
  return tokens;
}

/** Luminância relativa do WCAG 2.x a partir de #rrggbb. */
function luminance(hex: string): number {
  const channel = (at: number): number => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Razão de contraste do WCAG 2.x: (mais clara + 0,05) / (mais escura + 0,05). */
function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

const LIGHT = blockOf(/(?<![\w:\]]):root\s*\{([^}]*)\}/);
const DARK = blockOf(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);
const DARK_BY_SYSTEM = blockOf(/:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/);

test("o bloco escuro pelo sistema e o forçado têm as mesmas cores", () => {
  const forced = tokensOf(DARK);
  const bySystem = tokensOf(DARK_BY_SYSTEM);
  assert.deepEqual([...bySystem].sort(), [...forced].sort());
});

for (const [mode, block] of [
  ["claro", LIGHT],
  ["escuro", DARK],
] as const) {
  for (const [text, background] of PAIRS) {
    test(`${mode}: --${text} sobre --${background} chega a ${MIN_RATIO}:1`, () => {
      const ratio = contrastRatio(tokenIn(block, text), tokenIn(block, background));
      assert.ok(ratio >= MIN_RATIO, `${ratio.toFixed(2)}:1 abaixo de ${MIN_RATIO}:1`);
    });
  }
}
