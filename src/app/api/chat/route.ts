import { NextRequest, NextResponse } from "next/server"
import { requireAuthApi } from "@/lib/auth-utils"
import { envoyerMessageChat, type ChatMessage } from "@/lib/chat"
import { executerAvecDroitsChat } from "@/lib/chat-tools"

export const dynamic = "force-dynamic"

function validerMessages(value: unknown): value is ChatMessage[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        "role" in message &&
        (message.role === "user" || message.role === "assistant") &&
        "content" in message &&
        typeof message.content === "string" &&
        message.content.trim() !== "" &&
        message.content.length <= 8000
    )
  )
}

export async function POST(request: NextRequest) {
  const { error, session } = await requireAuthApi(request)
  if (error) return error
  const userId = session!.user.id

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 })
  }

  if (typeof body !== "object" || body === null || !("messages" in body)) {
    return NextResponse.json({ error: "La liste des messages est requise" }, { status: 400 })
  }

  const { messages, section } = body as { messages?: unknown; section?: unknown }
  if (!validerMessages(messages)) {
    return NextResponse.json(
      { error: "Les messages doivent être non vides et respecter le format attendu" },
      { status: 400 }
    )
  }
  if (section !== undefined && (typeof section !== "string" || section.length > 100)) {
    return NextResponse.json(
      { error: "La section doit être une chaîne de 100 caractères maximum" },
      { status: 400 }
    )
  }

  let contexte: string | null = null
  try {
    const { construireContexteMeteo } = await import("@/lib/chat-contexte")
    contexte = await construireContexteMeteo(userId)
  } catch {
    contexte = null
  }

  try {
    // Upstream exclut /api/chat du refus par méthode : le refus des outils
    // d'écriture pour un rôle en lecture seule est posé ici, à l'exécution.
    const peutEcrire = session!.user.peutEcrireExploitation !== false
    const reply = await executerAvecDroitsChat({ peutEcrire }, () =>
      envoyerMessageChat(messages, section as string | undefined, contexte ?? undefined, userId)
    )
    return NextResponse.json({ reply })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
