import { NextResponse } from "next/server"
import { requireAdminApi } from "@/lib/auth-utils"
import { envoyerMessageChat } from "@/lib/chat"

export const dynamic = "force-dynamic"

export async function POST() {
  const { error } = await requireAdminApi()
  if (error) return error

  try {
    const reponse = await envoyerMessageChat([
      { role: "user", content: "Réponds simplement : bonjour" },
    ])
    return NextResponse.json({
      message: "Connexion au chat IA réussie",
      reponse,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { error: `Échec du test : ${detail}` },
      { status: 502 }
    )
  }
}
