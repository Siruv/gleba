export type ChatProvider = "ollama" | "openai" | "anthropic" | "custom" | "openai-codex"

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

type MessageAvecSysteme = {
  role: "system" | "user" | "assistant"
  content: string
}

const texteSystemeBase =
  "Tu es l'assistant IA de Gleba, un logiciel libre de gestion agricole (maraîchage, verger, élevage, comptabilité). Réponds en français, de façon concise et pratique."
const reponseMaximaleErreur = 1000

function estProvider(value: string): value is ChatProvider {
  return value === "ollama" || value === "openai" || value === "anthropic" || value === "custom" || value === "openai-codex"
}

function detailErreur(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function tronquerDetail(detail: string): string {
  return detail.length > reponseMaximaleErreur
    ? `${detail.slice(0, reponseMaximaleErreur)}…`
    : detail
}

function urlAvecChemin(baseUrl: string, chemin: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${chemin}`
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

  if (provider === "openai" || provider === "anthropic") {
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
    case "anthropic":
      return "claude-sonnet-4-5"
    case "custom":
      throw new Error("Indiquez le modèle à utiliser pour le provider personnalisé")
    case "openai-codex":
      return "gpt-4o-mini"
  }
}

function construireMessageSysteme(section?: string): string {
  if (!section) return texteSystemeBase
  return `${texteSystemeBase} Contexte actuel de l'utilisateur : section ${section}.`
}

async function lireJsonProvider(response: Response, provider: ChatProvider): Promise<unknown> {
  const corps = await response.text()
  const detail = tronquerDetail(corps || "Réponse vide")

  if (!response.ok) {
    throw new Error(`Erreur API ${provider} (${response.status}) : ${detail}`)
  }

  try {
    return JSON.parse(corps) as unknown
  } catch {
    throw new Error(`Réponse invalide du provider ${provider} : ${detail}`)
  }
}

async function appelerApiCompatibleOpenai(
  provider: "openai" | "custom",
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: MessageAvecSysteme[]
): Promise<string> {
  const url = urlAvecChemin(baseUrl, "chat/completions")
  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages }),
      signal: AbortSignal.timeout(60_000),
    })
  } catch (error) {
    throw new Error(`Erreur réseau avec le provider ${provider} : ${tronquerDetail(detailErreur(error))}`)
  }

  const data = await lireJsonProvider(response, provider)
  if (
    typeof data !== "object" ||
    data === null ||
    !("choices" in data) ||
    !Array.isArray(data.choices) ||
    data.choices.length === 0 ||
    typeof data.choices[0] !== "object" ||
    data.choices[0] === null ||
    !("message" in data.choices[0]) ||
    typeof data.choices[0].message !== "object" ||
    data.choices[0].message === null ||
    !("content" in data.choices[0].message) ||
    typeof data.choices[0].message.content !== "string"
  ) {
    throw new Error(`Réponse invalide du provider ${provider} : contenu de réponse absent`)
  }

  return data.choices[0].message.content
}

async function appelerAnthropic(
  baseUrl: string,
  apiKey: string,
  model: string,
  systeme: string,
  messages: ChatMessage[]
): Promise<string> {
  const url = urlAvecChemin(baseUrl, "messages")
  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, max_tokens: 1024, system: systeme, messages }),
      signal: AbortSignal.timeout(60_000),
    })
  } catch (error) {
    throw new Error(`Erreur réseau avec le provider anthropic : ${tronquerDetail(detailErreur(error))}`)
  }

  const data = await lireJsonProvider(response, "anthropic")
  if (
    typeof data !== "object" ||
    data === null ||
    !("content" in data) ||
    !Array.isArray(data.content) ||
    data.content.length === 0 ||
    typeof data.content[0] !== "object" ||
    data.content[0] === null ||
    !("text" in data.content[0]) ||
    typeof data.content[0].text !== "string"
  ) {
    throw new Error("Réponse invalide du provider anthropic : contenu de réponse absent")
  }

  return data.content[0].text
}

/** Envoie un historique de conversation au provider IA configuré. */
export async function envoyerMessageChat(
  messages: ChatMessage[],
  section?: string
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
  const systeme = construireMessageSysteme(section)
  const messagesAvecSysteme: MessageAvecSysteme[] = [
    { role: "system", content: systeme },
    ...historique,
  ]

  if (provider === "ollama") {
    const ollamaHost = (await getSetting("chat.ollamaHost")).trim()
    try {
      const { Ollama } = await import("ollama")
      const ollama = new Ollama({ host: ollamaHost })
      const response = await ollama.chat({ model, messages: messagesAvecSysteme })
      if (typeof response.message?.content !== "string") {
        throw new Error("Réponse invalide : contenu de réponse absent")
      }
      return response.message.content
    } catch (error) {
      throw new Error(`Erreur réseau/API avec le provider ollama : ${tronquerDetail(detailErreur(error))}`)
    }
  }

  if (provider === "openai-codex") {
    const { envoyerMessageCodex } = await import("@/lib/chat-codex")
    return envoyerMessageCodex(historique, model, systeme)
  }

  const apiKey = (await getSetting("chat.apiKey")).trim()
  if (provider === "anthropic") {
    const baseUrl = (await getSetting("chat.baseUrl")).trim() || "https://api.anthropic.com/v1"
    return appelerAnthropic(baseUrl, apiKey, model, systeme, historique)
  }

  const baseUrl = (await getSetting("chat.baseUrl")).trim() || "https://api.openai.com/v1"
  return appelerApiCompatibleOpenai(provider, baseUrl, apiKey, model, messagesAvecSysteme)
}
