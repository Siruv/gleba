import { NextResponse } from "next/server"
import { requireAdminApi } from "@/lib/auth-utils"

export async function GET() {
  const { error } = await requireAdminApi()
  if (error) return error

  try {
    const { getSetting } = await import("@/lib/settings")
    const apiKey = (await getSetting("chat.apiKey")).trim()
    if (apiKey === "") {
      return NextResponse.json({ error: "Renseignez la clé API Mistral d'abord." }, { status: 400 })
    }

    const baseUrl = (await getSetting("chat.baseUrl")).trim() || "https://api.mistral.ai/v1"
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      return NextResponse.json(
        { error: `Impossible de récupérer les modèles (HTTP ${response.status}).` },
        { status: 502 }
      )
    }

    const data = await response.json()
    if (!data || !Array.isArray(data.data)) {
      return NextResponse.json({ modeles: [] })
    }

    // Filtrer : uniquement les modèles avec completion_chat
    type MistralModel = {
      id: string
      name?: string
      description?: string
      capabilities?: {
        completion_chat?: boolean
        function_calling?: boolean
      }
    }

    const modeles = (data.data as MistralModel[])
      .filter((m) => m.capabilities?.completion_chat === true)
      .map((m) => ({
        id: m.id,
        nom: m.name || m.id,
        description: m.description || "",
        functionCalling: m.capabilities?.function_calling === true,
      }))
      .sort((a, b) => a.id.localeCompare(b.id))

    return NextResponse.json({ modeles })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Impossible de récupérer les modèles." },
      { status: 502 }
    )
  }
}
