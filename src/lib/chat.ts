export type ChatProvider = "ollama" | "openai" | "anthropic" | "custom" | "openai-codex" | "mistral"

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}



const texteSystemeBase = `Tu es l'assistant IA de Gleba, un logiciel libre de gestion agricole (maraîchage, verger, élevage, comptabilité). Tu réponds en français, de façon concise et pratique, en utilisant le formatage Markdown (gras, listes, titres) pour structurer tes réponses.

OUTILS DISPONIBLES — Tu disposes d'outils pour consulter et modifier les données réelles de l'exploitation :
- Lecture : get_meteo_parcelles, get_cultures, get_planches, get_recoltes, get_especes, get_stocks, get_planification, get_dashboard_stats
- Écriture : create_intervention, create_culture, update_culture, create_planche, delete_planche, create_objet_jardin, delete_objet_jardin, create_variete_perso, delete_variete_perso, delete_culture

RÈGLES ABSOLUES :
1. Avant de répondre à une question sur les données de l'exploitation (cultures, planches, météo, stocks, récoltes…), appelle TOUJOURS l'outil de lecture adapté. Ne devine jamais, n'invente jamais de données.
2. Ne prétends JAMAIS avoir créé, modifié ou supprimé quoi que ce soit sans avoir appelé l'outil correspondant ET reçu un résultat de succès. Si l'appel d'outil échoue, dis-le honnêtement.
3. Si l'utilisateur demande une action pour laquelle aucun outil n'existe, réponds clairement : « Je ne peux pas encore faire cette action. » N'invente pas de contournement.
4. AVANT TOUTE SUPPRESSION (delete_planche, delete_objet_jardin, delete_variete_perso, delete_culture) : demande d'abord une confirmation explicite à l'utilisateur en nommant précisément l'objet concerné (ex : « Confirmez-vous la suppression de la planche "Prairie 1" ? »). N'appelle l'outil de suppression qu'après une réponse clairement affirmative.
5. Pour créer une planche ou un objet dans une parcelle, commence par appeler get_planches ou l'outil de lecture adapté pour comprendre la structure existante (noms de parcelles, planches déjà présentes) avant d'agir.
6. Quand l'utilisateur mentionne un lieu (ex : « dans la prairie »), comprends qu'il s'agit probablement du NOM d'une parcelle ou d'un îlot existant — cherche-le avec les outils de lecture au lieu de le traiter comme un nom d'objet à créer.`

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
