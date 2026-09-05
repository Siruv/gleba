import { NextResponse } from "next/server"
import { requireAdminApi } from "@/lib/auth-utils"

type ModeleGenerique = {
  id: string
  nom: string
  description: string
  functionCalling: boolean
}

const PROVIDERS_SUPPORTES = ["openai", "anthropic", "ollama", "custom"]

export async function GET(request: Request) {
  const { error } = await requireAdminApi()
  if (error) return error

  const { searchParams } = new URL(request.url)
  const provider = searchParams.get("provider") ?? ""
  if (!PROVIDERS_SUPPORTES.includes(provider)) {
    return NextResponse.json({ error: `Provider non supporté : ${provider}` }, { status: 400 })
  }

  try {
    const { getSetting } = await import("@/lib/settings")

    if (provider === "ollama") {
      const ollamaHost = (await getSetting("chat.ollamaHost")).trim() || "http://localhost:11434"
      const response = await fetch(`${ollamaHost.replace(/\/+$/, "")}/api/tags`, {
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) {
        return NextResponse.json({ error: `Ollama injoignable (HTTP ${response.status}).` }, { status: 502 })
      }
      const data = await response.json()
      const modeles: ModeleGenerique[] = Array.isArray(data.models)
        ? data.models.map((m: { name?: string }) => ({
            id: m.name ?? "",
            nom: m.name ?? "",
            description: "Modèle local Ollama",
            functionCalling: false,
          })).filter((m: ModeleGenerique) => m.id !== "")
        : []
      return NextResponse.json({ modeles })
    }

    const apiKey = (await getSetting("chat.apiKey")).trim()
    if (apiKey === "") {
      return NextResponse.json({ error: "Renseignez la clé API d'abord." }, { status: 400 })
    }

    if (provider === "anthropic") {
      const baseUrl = (await getSetting("chat.baseUrl")).trim() || "https://api.anthropic.com/v1"
      const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) {
        return NextResponse.json({ error: `Impossible de récupérer les modèles Anthropic (HTTP ${response.status}).` }, { status: 502 })
      }
      const data = await response.json()
      const modeles: ModeleGenerique[] = Array.isArray(data.data)
        ? data.data.map((m: { id?: string; display_name?: string }) => ({
            id: m.id ?? "",
            nom: m.display_name || m.id || "",
            description: "Modèle Anthropic Claude",
            functionCalling: true,
          })).filter((m: ModeleGenerique) => m.id !== "")
        : []
      return NextResponse.json({ modeles })
    }

    // openai et custom : format OpenAI /v1/models
    const baseUrl = provider === "openai"
      ? ((await getSetting("chat.baseUrl")).trim() || "https://api.openai.com/v1")
      : (await getSetting("chat.baseUrl")).trim()
    if (baseUrl === "") {
      return NextResponse.json({ error: "Renseignez l'URL de base d'abord." }, { status: 400 })
    }

    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      return NextResponse.json({ error: `Impossible de récupérer les modèles (HTTP ${response.status}).` }, { status: 502 })
    }
    const data = await response.json()
    if (!Array.isArray(data.data)) {
      return NextResponse.json({ modeles: [] })
    }

    const exclus = ["embedding", "tts", "whisper", "dall-e", "audio", "realtime", "babbage", "davinci", "moderation"]
    const modeles: ModeleGenerique[] = data.data
      .map((m: { id?: string }) => m.id ?? "")
      .filter((id: string) => id !== "" && !exclus.some((motif) => id.toLowerCase().includes(motif)))
      .map((id: string) => ({
        id,
        nom: id,
        description: provider === "openai" ? "Modèle OpenAI" : "Modèle compatible OpenAI",
        functionCalling: provider === "openai",
      }))
      .sort((a: ModeleGenerique, b: ModeleGenerique) => a.id.localeCompare(b.id))

    return NextResponse.json({ modeles })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Impossible de récupérer les modèles." },
      { status: 502 }
    )
  }
}
