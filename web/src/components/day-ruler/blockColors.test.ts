import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Blocos da régua: o ícone sobre a cor sólida usa --accent-text (text-primary-foreground); o bloco já passado é a cor
// misturada com a superfície (color-mix 40%), e nele o ícone usa o texto normal. Mesmo critério de theme/contrast.test.ts.

/** Ícone é gráfico: o mínimo de WCAG 2.x para contraste de objetos é 3:1, e usamos 4.5:1 como nas cores de texto. */
const MIN_RATIO = 4.5;
/** Fração da cor de situação na mistura do bloco passado (o resto é a superfície). */
const PASSED_SHARE = 0.4;
const STATUS_TOKENS = ["ok", "warn", "bad"] as const;

const CSS = readFileSync(fileURLToPath(new URL("../../tailwind.css", import.meta.url)), "utf8");

function blockOf(selector: RegExp): string {
  const match = selector.exec(CSS);
  if (!match) throw new Error(`bloco ${selector} não achado em tailwind.css`);
  return match[1];
}

function tokenIn(block: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(block);
  if (!match) throw new Error(`--${name} não definido no bloco`);
  return match[1];
}

function luminance(hex: string): number {
  const channel = (at: number): number => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Mistura em sRGB igual ao color-mix(in srgb, cor share%, base): canal a canal. */
function mix(share: number, color: string, base: string): string {
  const channels = [1, 3, 5].map((at) => {
    const from = parseInt(color.slice(at, at + 2), 16);
    const onto = parseInt(base.slice(at, at + 2), 16);
    return Math.round(share * from + (1 - share) * onto).toString(16).padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

const LIGHT = blockOf(/(?<![\w:\]]):root\s*\{([^}]*)\}/);
const DARK = blockOf(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/);

for (const [mode, block] of [
  ["claro", LIGHT],
  ["escuro", DARK],
] as const) {
  for (const status of STATUS_TOKENS) {
    test(`${mode}: ícone --accent-text sobre o bloco sólido --${status} chega a ${MIN_RATIO}:1`, () => {
      const ratio = contrastRatio(tokenIn(block, "accent-text"), tokenIn(block, status));
      assert.ok(ratio >= MIN_RATIO, `${ratio.toFixed(2)}:1 abaixo de ${MIN_RATIO}:1`);
    });

    test(`${mode}: ícone --text sobre o bloco passado de --${status} chega a ${MIN_RATIO}:1`, () => {
      const passed = mix(PASSED_SHARE, tokenIn(block, status), tokenIn(block, "surface"));
      const ratio = contrastRatio(tokenIn(block, "text"), passed);
      assert.ok(ratio >= MIN_RATIO, `${ratio.toFixed(2)}:1 abaixo de ${MIN_RATIO}:1`);
    });
  }
}
