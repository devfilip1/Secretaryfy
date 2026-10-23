// Textos da proteção do número (specs/004, contracts/conversation.md). Ao cliente em inglês, como as demais
// respostas; os registros do painel em português.

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
  optedOut: "🚫 O cliente pediu para não receber mensagens",
  optedIn: "✅ O cliente voltou a aceitar mensagens",
  reactivated: "✅ Mensagens reativadas pelo operador",
  loop: "⚠️ Possível conversa com outro robô: o assistente foi pausado",
  dailyConversations: "⚠️ Limite diário de conversas atingido: o assistente não respondeu",
  rateLimited: "⚠️ A resposta demorou demais na fila e não foi enviada",
  paused: "⚠️ Envios automáticos pausados pela proteção: o assistente não respondeu",
};
