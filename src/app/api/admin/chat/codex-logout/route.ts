import { NextResponse } from "next/server"
import { requireAdminApi } from "@/lib/auth-utils"
import { setSetting } from "@/lib/settings"

export async function POST() {
  const { error } = await requireAdminApi()
  if (error) return error

  try {
    await setSetting("chat.codexAccessToken", "")
    await setSetting("chat.codexRefreshToken", "")
    return NextResponse.json({ status: "disconnected" })
  } catch (error) {
    console.error("POST /api/admin/chat/codex-logout error:", error)
    return NextResponse.json(
      { error: "Impossible de déconnecter ChatGPT." },
      { status: 500 }
    )
  }
}
