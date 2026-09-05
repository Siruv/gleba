import { NextResponse } from "next/server"
import { requireAdminApi } from "@/lib/auth-utils"
import { demarrerConnexionCodex } from "@/lib/chat-codex"

export async function POST() {
  const { error } = await requireAdminApi()
  if (error) return error

  try {
    return NextResponse.json(await demarrerConnexionCodex())
  } catch (error) {
    console.error("POST /api/admin/chat/codex-login error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Impossible de démarrer la connexion à ChatGPT." },
      { status: 502 }
    )
  }
}
