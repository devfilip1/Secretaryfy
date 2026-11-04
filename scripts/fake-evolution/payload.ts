// Montagem dos eventos que a Evolution API mandaria ao webhook, no formato que parseEvolutionEvent() lê.

export interface CustomerMessageInput {
  instance: string;
  phone: string;
  name: string;
  text: string;
  id: string;
  /** segundos desde a época, como a Evolution envia */
  timestamp: number;
}

/** Mensagem de texto de um cliente (messages.upsert). */
export function buildMessageUpsert({ instance, phone, name, text, id, timestamp }: CustomerMessageInput) {
  return {
    event: "messages.upsert",
    instance,
    data: {
      key: { id, remoteJid: `${phone}@s.whatsapp.net`, fromMe: false },
      pushName: name,
      messageTimestamp: timestamp,
      message: { conversation: text },
    },
  };
}

/** Número pareado: a Evolution avisa com connection.update state open e o wuid do número. */
export function buildConnectionOpen(instance: string, owner: string) {
  return {
    event: "connection.update",
    instance,
    data: { state: "open", wuid: `${owner}@s.whatsapp.net` },
  };
}

/**
 * O webhook guardado foi montado com WEBHOOK_BASE_URL (ex.: host.docker.internal, que o host não resolve).
 * Troca só a origem pela do app; caminho e ?token= ficam como estão.
 */
export function webhookTarget(webhookUrl: string, appOrigin: string): string {
  const url = new URL(webhookUrl);
  return `${appOrigin}${url.pathname}${url.search}`;
}
