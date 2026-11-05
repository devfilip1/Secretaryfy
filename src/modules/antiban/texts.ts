// Textos da proteção do número (specs/004, contracts/conversation.md). Ao cliente na língua da clínica (CLINIC_LANGUAGE);
// os registros do painel continuam em inglês.

export type FixedTexts = {
  unavailable: string[];
  optOutConfirmation: string[];
  optIn: string[];
};

/** Mensagens fixas com variações: nunca o mesmo texto repetido para o mesmo cliente (FR-017). */
const FIXED_TEXTS: Record<"en" | "pt", FixedTexts> = {
  en: {
    unavailable: [
      "Sorry, I'm having a little trouble on my end. Could you write to me again in a few minutes?",
      "I ran into a problem just now. Could you send your message again shortly?",
      "Apologies, I can't answer right now. Please try again in a little while.",
    ],
    optOutConfirmation: [
      "Done — you won't receive any more messages from us here. If you change your mind, just reply START.",
      "Understood. We'll stop messaging you on WhatsApp. Reply START anytime to talk to us again.",
      "All set, no more messages from us. Should you need us again, reply START.",
    ],
    optIn: ["Welcome back! How can we help you today?", "Great to hear from you again. How can we help?"],
  },
  pt: {
    unavailable: [
      "Desculpe, estou com um probleminha por aqui. Pode me escrever de novo daqui a alguns minutos?",
      "Tive uma dificuldade agora. Pode me mandar a mensagem de novo em instantes?",
      "Desculpe, não consegui responder agora. Tente de novo daqui a pouco, por favor.",
    ],
    optOutConfirmation: [
      "Pronto — você não receberá mais mensagens nossas por aqui. Se mudar de ideia, responda VOLTAR.",
      "Entendido. Não vamos mais enviar mensagens pelo WhatsApp. Responda VOLTAR quando quiser falar conosco de novo.",
      "Tudo certo, não enviaremos mais mensagens. Se precisar de nós, responda VOLTAR.",
    ],
    optIn: ["Que bom ter você de volta! Como podemos ajudar hoje?", "Que bom falar com você de novo. Como podemos ajudar?"],
  },
};

/** Os textos fixos na língua da clínica. */
export const fixedTextsFor = (language: "en" | "pt"): FixedTexts => FIXED_TEXTS[language];

/** Registros no histórico do painel (origin = system). */
export const protectionNotes = {
  optedOut: "The customer asked not to receive messages",
  optedIn: "The customer accepts messages again",
  reactivated: "Messages reactivated by the operator",
  loop: "Possibly talking to another bot: the assistant was paused",
  dailyConversations: "Daily conversation limit reached: the assistant did not reply",
  rateLimited: "The reply waited too long in the queue and was not sent",
  paused: "Automatic sending paused by protection: the assistant did not reply",
};
