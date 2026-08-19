/**
 * Boucle de tool-calling pour le provider Ollama (API REST /api/chat).
 * Consomme les outils partagés de chat-tools.ts.
 * Note : tous les modèles Ollama ne supportent pas le tool-calling ;
 * si un modèle renvoie une erreur sur les tools, l'appel retombe en mode sans outils.
 */

type MessageChat = { role: string; content: string }

/** Convertit les outils au format Ollama (compatible OpenAI function) */
export async function outilsFormatOllama(): Promise<Array<{
  type: "function"
  function: { name: string; description: string; parameters: Record<string, unknown> }
}>> {
  const { outilsChat } = await import("@/lib/chat-tools")
  return outilsChat.map((outil) => ({
    type: "function" as const,
    function: {
      name: outil.name,
      description: outil.description,
      parameters: outil.parameters,
    },
  }))
}

export async function envoyerMessageOllamaAvecOutils(
  ollamaHost: string,
  model: string,
  systeme: string,
  messages: MessageChat[],
  userId?: string
): Promise<string> {
  const url = `${ollamaHost.replace(/\/+$/, "")}/api/chat`

  const tools = userId ? await outilsFormatOllama() : undefined

  const messagesComplets: Array<Record<string, unknown>> = [
    { role: "system", content: systeme },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ]

  let iteration = 0
  const maxIterations = 5

  const appeler = async (avecOutils: boolean): Promise<Record<string, unknown>> => {
    const body: Record<string, unknown> = {
      model,
      messages: messagesComplets,
      stream: false,
    }
    if (avecOutils && tools && tools.length > 0) {
      body.tools = tools
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      throw new Error(`Erreur Ollama (HTTP ${response.status}) : ${detail.slice(0, 200)}`)
    }
    return (await response.json()) as Record<string, unknown>
  }

  while (iteration < maxIterations) {
    iteration++

    let data: Record<string, unknown>
    try {
      data = await appeler(true)
    } catch (erreur) {
      // Si le modèle ne supporte pas les tools, retenter sans outils
      const message = erreur instanceof Error ? erreur.message : String(erreur)
      if (iteration === 1 && /tool/i.test(message)) {
        data = await appeler(false)
      } else {
        throw erreur
      }
    }

    const message = data.message as
      | {
          role?: string
          content?: string
          tool_calls?: Array<{ function?: { name?: string; arguments?: Record<string, unknown> } }>
        }
      | undefined
    if (!message) {
      throw new Error("Réponse invalide d'Ollama : message absent.")
    }

    // Si le modèle demande des appels d'outils
    if (message.tool_calls && message.tool_calls.length > 0 && userId) {
      const { executerOutil } = await import("@/lib/chat-tools")

      // Ajouter le message assistant avec tool_calls à l'historique
      messagesComplets.push({
        role: "assistant",
        content: message.content ?? "",
        tool_calls: message.tool_calls,
      })

      // Exécuter chaque outil et ajouter les résultats
      for (const toolCall of message.tool_calls) {
        const nomFonction = toolCall.function?.name ?? ""
        const args = toolCall.function?.arguments ?? {}
        const resultat = await executerOutil(nomFonction, JSON.stringify(args), userId)
        messagesComplets.push({
          role: "tool",
          content: resultat,
        })
      }
      continue // Continuer la boucle pour obtenir la réponse finale
    }

    // Pas d'appels d'outils : retourner le texte
    if (typeof message.content === "string" && message.content !== "") {
      return message.content
    }

    throw new Error("Réponse vide du modèle Ollama.")
  }

  throw new Error("Trop d'appels d'outils consécutifs.")
}
