export type ChatProvider = "ollama" | "openai" | "anthropic" | "custom" | "openai-codex" | "mistral"

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}



const texteSystemeBase =
  "Tu es l'assistant IA de Gleba, un logiciel libre de gestion agricole (maraîchage, verger, élevage, comptabilité). Réponds en français, de façon concise et pratique."

const urlsParDefaut: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  mistral: "https://api.mistral.ai/v1",
  custom: "",
}

function estProvider(value: string): value is ChatProvider {
  return value === "ollama" || value === "openai" || value === "anthropic" || value === "custom" || value === "openai-codex" || value === "mistral"
}







/** Indique si la configuration actuelle permet d'utiliser le chat IA. */
export async function chatActif(): Promise<boolean> {
  const { getSetting } = await import("@/lib/settings")
  const providerConfig = await getSetting("chat.provider")
  const provider = providerConfig.trim()
  const apiKey = (await getSetting("chat.apiKey")).trim()

  if (provider === "ollama") {
    return (await getSetting("chat.ollamaHost")).trim() !== ""
  }

  if (provider === "openai" || provider === "anthropic" || provider === "mistral") {
    return apiKey !== ""
  }

  if (provider === "openai-codex") {
    return (await getSetting("chat.codexAccessToken")).trim() !== ""
  }

  if (provider === "custom") {
    return apiKey !== "" && (await getSetting("chat.baseUrl")).trim() !== ""
  }

  return false
}

/** Retourne le modèle effectif à utiliser pour un provider. */
export function modeleEffectif(provider: ChatProvider, modelConfig: string): string {
  if (modelConfig.trim() !== "") return modelConfig.trim()

  switch (provider) {
    case "ollama":
      return process.env.OLLAMA_MODEL || "glm-4.7"
    case "openai":
      return "gpt-4o-mini"
    case "mistral":
      return "mistral-small-latest"
    case "anthropic":
      return "claude-sonnet-4-5"
    case "custom":
      throw new Error("Indiquez le modèle à utiliser pour le provider personnalisé")
    case "openai-codex":
      return "gpt-4o-mini"
  }
}

function construireMessageSysteme(section?: string, contexte?: string): string {
  const messageBase = section
    ? `${texteSystemeBase} Contexte actuel de l'utilisateur : section ${section}.`
    : texteSystemeBase
  if (!contexte) return messageBase
  return `${messageBase}\n\nDonnées réelles de l'exploitation :\n${contexte}\nUtilise ces données pour répondre précisément aux questions concernées (météo, irrigation, etc.).`
}







/**
 * Envoie un historique de conversation au provider IA configuré.
 *
 * EXTENSIBILITÉ — Pour brancher un NOUVEAU provider au tool-calling :
 * 1. Crée un fichier src/lib/chat-<provider>-tools.ts qui implémente une boucle
 *    de tool-calling consommant `outilsChat` et `executerOutil()` de chat-tools.ts
 *    (voir chat-openai-tools.ts, chat-anthropic-tools.ts, chat-ollama-tools.ts).
 * 2. Ajoute le provider au type `ChatProvider` et à `estProvider()` ci-dessus.
 * 3. Ajoute un bloc `if (provider === "<provider>")` dans `envoyerMessageChat`
 *    qui appelle la nouvelle boucle.
 * Les outils (lecture + écriture) seront alors automatiquement disponibles
 * pour ce provider, ainsi que via la route /api/mcp.
 */
export async function envoyerMessageChat(
  messages: ChatMessage[],
  section?: string,
  contexte?: string,
  userId?: string
): Promise<string> {
  if (!(await chatActif())) {
    throw new Error("Le chat IA n'est pas configuré. Renseignez la configuration dans l'administration.")
  }

  const { getSetting } = await import("@/lib/settings")
  const providerConfig = await getSetting("chat.provider")
  const providerValue = providerConfig.trim()
  if (!estProvider(providerValue)) {
    throw new Error(`Provider de chat inconnu : ${providerConfig}`)
  }
  const provider: ChatProvider = providerValue
  const model = modeleEffectif(provider, await getSetting("chat.model"))
  const historique = messages.slice(-20)
  const systeme = construireMessageSysteme(section, contexte)

  if (provider === "ollama") {
    const ollamaHost = (await getSetting("chat.ollamaHost")).trim()
    const { envoyerMessageOllamaAvecOutils } = await import("@/lib/chat-ollama-tools")
    return envoyerMessageOllamaAvecOutils(ollamaHost, model, systeme, historique, userId)
  }

  if (provider === "openai-codex") {
    const { envoyerMessageCodex } = await import("@/lib/chat-codex")
    return envoyerMessageCodex(historique, model, systeme, userId)
  }

  const apiKey = (await getSetting("chat.apiKey")).trim()

  if (provider === "mistral" || provider === "openai" || provider === "custom") {
    const baseUrl = (await getSetting("chat.baseUrl")).trim() || urlsParDefaut[provider]
    const { envoyerMessageAvecOutils } = await import("@/lib/chat-openai-tools")
    return envoyerMessageAvecOutils(baseUrl, apiKey, model, systeme, historique, userId)
  }

  if (provider === "anthropic") {
    const baseUrl = (await getSetting("chat.baseUrl")).trim() || "https://api.anthropic.com/v1"
    const { envoyerMessageAnthropicAvecOutils } = await import("@/lib/chat-anthropic-tools")
    return envoyerMessageAnthropicAvecOutils(baseUrl, apiKey, model, systeme, historique, userId)
  }

  throw new Error(`Provider de chat non géré : ${provider}`)
}
