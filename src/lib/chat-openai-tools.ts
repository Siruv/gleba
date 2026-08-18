/**
 * Boucle de tool-calling pour les providers compatibles OpenAI Chat Completions.
 * Fonctionne avec Mistral, OpenAI, et tout provider custom compatible.
 */

type MessageChat = { role: string; content: string }

type ToolCallRecu = {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

type MessageAvecToolCalls = {
  role: "assistant"
  content: string | null
  tool_calls?: ToolCallRecu[]
}

type MessageToolResult = {
  role: "tool"
  tool_call_id: string
  content: string
}

/** Convertit les outils au format Chat Completions OpenAI */
export async function outilsFormatOpenAI(): Promise<Array<{
  type: "function"
  function: { name: string; description: string; parameters: Record<string, unknown> }
}>> {
  const { outilsChat } = await import("@/lib/chat-tools")
  return outilsChat.map((outil: any) => ({
    type: "function" as const,
    function: {
      name: outil.name,
      description: outil.description,
      parameters: outil.parameters,
    },
  }))
}

export async function envoyerMessageAvecOutils(
  baseUrl: string,
  apiKey: string,
  model: string,
  systeme: string,
  messages: MessageChat[],
  userId?: string
): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`
  
  // Charger les outils si userId est fourni
  const tools = userId ? await outilsFormatOpenAI() : undefined

  // Construire la liste de messages
  let messagesComplets: Array<Record<string, unknown>> = [
    { role: "system", content: systeme },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ]

  let iteration = 0
  const maxIterations = 5

  while (iteration < maxIterations) {
    iteration++

    const body: Record<string, unknown> = {
      model,
      messages: messagesComplets,
    }
    if (tools && tools.length > 0) {
      body.tools = tools
      body.tool_choice = "auto"
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      throw new Error(`Erreur API (HTTP ${response.status}) : ${detail.slice(0, 200)}`)
    }

    const data = await response.json()
    const choix = data.choices?.[0]
    if (!choix) throw new Error("Réponse invalide : pas de choix dans la réponse.")

    const message = choix.message as MessageAvecToolCalls

    // Si le modèle demande des appels d'outils
    if (message.tool_calls && message.tool_calls.length > 0 && userId) {
      const { executerOutil } = await import("@/lib/chat-tools")

      // Ajouter le message assistant avec tool_calls à l'historique
      messagesComplets.push({
        role: "assistant",
        content: message.content || null,
        tool_calls: message.tool_calls,
      })

      // Exécuter chaque outil et ajouter les résultats
      for (const toolCall of message.tool_calls) {
        const resultat = await executerOutil(
          toolCall.function.name,
          toolCall.function.arguments,
          userId
        )
        messagesComplets.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: resultat,
        })
      }

      continue // Continuer la boucle pour obtenir la réponse finale
    }

    // Pas d'appels d'outils : retourner le texte
    if (typeof message.content === "string" && message.content !== "") {
      return message.content
    }

    throw new Error("Réponse vide du modèle.")
  }

  throw new Error("Trop d'appels d'outils consécutifs.")
}
