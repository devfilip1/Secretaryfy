// URLs com esquema, com www., ou domínio com um TLD comum. Não pega "10.30" nem "e.g.".
const URL_PATTERN =
  /\b(?:https?:\/\/[^\s<>()]+|www\.[^\s<>()]+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|br|io|app|info|biz|me|co|link|ly|site|online|store|xyz)(?:\/[^\s<>()]*)?)/gi;

export const LINK_PLACEHOLDER = "(link removed)";

function hostOf(url: string): string {
  const withScheme = /^https?:\/\//i.test(url) ? url : `http://${url}`;
  try {
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function allowed(host: string, domains: string[]): boolean {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Tira os links que o assistente não deve mandar: todos na primeira resposta, e os de fora da lista nas demais
 * (research.md R7; FR-018). O ponto final grudado no link continua no texto.
 */
export function stripLinks(text: string, { firstReply, allowedDomains }: { firstReply: boolean; allowedDomains: string[] }) {
  let removed = 0;
  const result = text.replace(URL_PATTERN, (match) => {
    const trailing = match.match(/[.,;:!?]+$/)?.[0] ?? "";
    const url = trailing ? match.slice(0, -trailing.length) : match;
    if (!firstReply && allowed(hostOf(url), allowedDomains)) return match;
    removed++;
    return LINK_PLACEHOLDER + trailing;
  });
  return { text: result, removed };
}
