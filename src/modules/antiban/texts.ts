// Textos da proteção do número (specs/004, contracts/conversation.md). Ao cliente em inglês, como as demais
// respostas; os registros do painel também em inglês.

/** Mensagens fixas com variações: nunca o mesmo texto repetido para o mesmo cliente (FR-017). */
export const fixedTexts = {
  unavailable: [
    "Sorry, our virtual assistant is unavailable right now. Please try again in a few minutes.",
    "Our assistant is having trouble at the moment. Please send your message again shortly.",
    "Apologies, I can't answer right now. Please try again in a little while.",
  ],
  optOutConfirmation: [
    "Done — you won't receive any more messages from us here. If you change your mind, just reply START.",
    "Understood. We'll stop messaging you on WhatsApp. Reply START anytime to talk to us again.",
    "All set, no more messages from us. Should you need us again, reply START.",
  ],
  optIn: ["Welcome back! How can we help you today?", "Great to hear from you again. How can we help?"],
};

/** Registros no histórico do painel (origin = system). */
export const protectionNotes = {
  optedOut: "🚫 The customer asked not to receive messages",
  optedIn: "✅ The customer accepts messages again",
  reactivated: "✅ Messages reactivated by the operator",
  loop: "⚠️ Possibly talking to another bot: the assistant was paused",
  dailyConversations: "⚠️ Daily conversation limit reached: the assistant did not reply",
  rateLimited: "⚠️ The reply waited too long in the queue and was not sent",
  paused: "⚠️ Automatic sending paused by protection: the assistant did not reply",
};
