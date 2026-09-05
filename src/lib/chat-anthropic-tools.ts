/**
 * Boucle de tool-calling pour le provider Anthropic (API Messages).
 * Consomme les outils partagés de chat-tools.ts.
 */

type MessageChat = { role: string; content: string }

/** Convertit les outils au format Anthropic Messages API */
export async function outilsFormatAnthropic(): Promise<Array<{
  name: string
  description: string
  input_schema: Record<string, unknown>
}>> {
  const { outilsChat } = await import("@/lib/chat-tools")
  return outilsChat.map((outil) => ({
    name: outil.name,
    description: outil.description,
    input_schema: outil.parameters,
  }))
}

export async function envoyerMessageAnthropicAvecOutils(
  baseUrl: string,
  apiKey: string,
  model: string,
  systeme: string,
  messages: MessageChat[],
  userId?: string
): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, "")}/messages`

  const tools = userId ? await outilsFormatAnthropic() : undefined

  // L'API Anthropic ne prend pas de message "system" dans messages :
  // on passe le systeme via le champ dédié `system`.
  const messagesComplets: Array<Record<string, unknown>> = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }))

  let iteration = 0
  const maxIterations = 5

  while (iteration < maxIterations) {
    iteration++

    const body: Record<string, unknown> = {
      model,
      max_tokens: 4096,
      system: systeme,
      messages: messagesComplets,
    }
    if (tools && tools.length > 0) {
      body.tools = tools
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      throw new Error(`Erreur API Anthropic (HTTP ${response.status}) : ${detail.slice(0, 200)}`)
    }

    const data = await response.json()
    const content = data.content
    if (!Array.isArray(content) || content.length === 0) {
      throw new Error("Réponse invalide d'Anthropic : contenu absent.")
    }

    // Extraire les blocs tool_use s'il y en a
    const blocsToolUse = content.filter(
      (bloc: { type?: string }) => bloc.type === "tool_use"
    ) as Array<{ id: string; name: string; input: Record<string, unknown> }>

    if (blocsToolUse.length > 0 && userId) {
      const { executerOutil } = await import("@/lib/chat-tools")

      // Ajouter le message assistant complet (avec les blocs tool_use) à l'historique
      messagesComplets.push({ role: "assistant", content })

      // Exécuter chaque outil et ajouter un message user avec les blocs tool_result
      const blocsResultat: Array<Record<string, unknown>> = []
      for (const bloc of blocsToolUse) {
        const resultat = await executerOutil(
          bloc.name,
          JSON.stringify(bloc.input ?? {}),
          userId
        )
        blocsResultat.push({
          type: "tool_result",
          tool_use_id: bloc.id,
          content: resultat,
        })
      }
      messagesComplets.push({ role: "user", content: blocsResultat })

      continue // Continuer la boucle pour obtenir la réponse finale
    }

    // Pas d'appels d'outils : extraire le texte
    const blocTexte = content.find(
      (bloc: { type?: string }) => bloc.type === "text"
    ) as { text?: string } | undefined
    if (blocTexte && typeof blocTexte.text === "string" && blocTexte.text !== "") {
      return blocTexte.text
    }

    throw new Error("Réponse vide du modèle Anthropic.")
  }

  throw new Error("Trop d'appels d'outils consécutifs.")
}
