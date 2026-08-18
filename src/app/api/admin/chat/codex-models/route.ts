import { NextResponse } from "next/server"
import { requireAdminApi } from "@/lib/auth-utils"
import { listerModelesCodex } from "@/lib/chat-codex"

export async function GET() {
  const { error } = await requireAdminApi()
  if (error) return error

  try {
    const { getSetting } = await import("@/lib/settings")
    const accessToken = (await getSetting("chat.codexAccessToken")).trim()
    if (accessToken === "") {
      return NextResponse.json({ error: "Non connecté à ChatGPT." }, { status: 400 })
    }

    return NextResponse.json({ modeles: await listerModelesCodex(accessToken) })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Impossible de récupérer les modèles ChatGPT." },
      { status: 502 }
    )
  }
}
