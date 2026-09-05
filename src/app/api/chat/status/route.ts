import { NextResponse } from "next/server"
import { requireAuthApi } from "@/lib/auth-utils"
import { chatActif } from "@/lib/chat"

export const dynamic = "force-dynamic"

export async function GET() {
  const { error } = await requireAuthApi()
  if (error) return error

  try {
    return NextResponse.json({ actif: await chatActif() })
  } catch (error) {
    console.error("GET /api/chat/status error:", error)
    return NextResponse.json(
      { error: "Impossible de vérifier la configuration du chat IA" },
      { status: 500 }
    )
  }
}
