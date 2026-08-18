import { NextRequest, NextResponse } from "next/server"
import { requireAdminApi } from "@/lib/auth-utils"
import {
  echangerCodeCodex,
  sonderConnexionCodex,
} from "@/lib/chat-codex"
import { setSetting } from "@/lib/settings"

export async function POST(request: NextRequest) {
  const { error } = await requireAdminApi()
  if (error) return error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 })
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Les informations de connexion sont invalides" }, { status: 400 })
  }

  const { deviceAuthId, userCode } = body as {
    deviceAuthId?: unknown
    userCode?: unknown
  }
  if (typeof deviceAuthId !== "string" || typeof userCode !== "string" || !deviceAuthId || !userCode) {
    return NextResponse.json({ error: "Les informations de connexion sont invalides" }, { status: 400 })
  }

  try {
    const resultat = await sonderConnexionCodex(deviceAuthId, userCode)
    if (!resultat) return NextResponse.json({ status: "pending" })

    const tokens = await echangerCodeCodex(resultat.authorizationCode, resultat.codeVerifier)
    await setSetting("chat.codexAccessToken", tokens.accessToken)
    await setSetting("chat.codexRefreshToken", tokens.refreshToken)
    await setSetting("chat.provider", "openai-codex")
    return NextResponse.json({ status: "connected" })
  } catch (error) {
    console.error("POST /api/admin/chat/codex-login/poll error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Impossible de finaliser la connexion à ChatGPT." },
      { status: 502 }
    )
  }
}
