// Textos da proteção do número (specs/004, contracts/conversation.md). Ao cliente na língua da clínica (CLINIC_LANGUAGE);
// os registros do painel continuam em inglês.

export type FixedTexts = {
  unavailable: string[];
  optOutConfirmation: string[];
  optIn: string[];
  /** Aberturas de uma resposta igual a outra já enviada: a proteção a barraria, então sai com uma delas na frente */
  again: string[];
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
      "Done, you won't receive any more messages from us here. If you change your mind, just reply START.",
      "Understood. We'll stop messaging you on WhatsApp. Reply START anytime to talk to us again.",
      "All set, no more messages from us. Should you need us again, reply START.",
    ],
    optIn: ["Welcome back! How can we help you today?", "Great to hear from you again. How can we help?"],
    again: ["Of course!", "Happy to!", "Sure thing!"],
  },
  pt: {
    unavailable: [
      "Desculpe, estou com um probleminha por aqui. Pode me escrever de novo daqui a alguns minutos?",
      "Tive uma dificuldade agora. Pode me mandar a mensagem de novo em instantes?",
      "Desculpe, não consegui responder agora. Tente de novo daqui a pouco, por favor.",
    ],
    optOutConfirmation: [
      "Pronto, você não receberá mais mensagens nossas por aqui. Se mudar de ideia, responda VOLTAR.",
      "Entendido. Não vamos mais enviar mensagens pelo WhatsApp. Responda VOLTAR quando quiser falar conosco de novo.",
      "Tudo certo, não enviaremos mais mensagens. Se precisar de nós, responda VOLTAR.",
    ],
    optIn: ["Que bom ter você de volta! Como podemos ajudar hoje?", "Que bom falar com você de novo. Como podemos ajudar?"],
    again: ["Claro!", "Com prazer!", "Pois não!"],
  },
};

/** Os textos fixos na língua da clínica. */
export const fixedTextsFor = (language: "en" | "pt"): FixedTexts => FIXED_TEXTS[language];
