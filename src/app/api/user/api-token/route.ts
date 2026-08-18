/**
 * API Route pour la gestion du token API utilisateur
 * GET: Vérifier si un token existe et retourner un token masqué
 * POST: Générer un nouveau token API
 * DELETE: Révoquer le token API actuel
 */

import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { requireAuthApi } from "@/lib/auth-utils"
import { randomBytes } from "crypto"

// GET /api/user/api-token - Vérifier l'existence du token
export async function GET() {
  const { error, session } = await requireAuthApi()
  if (error) return error

  try {
    const user = await prisma.user.findUnique({
      where: { id: session!.user.id },
      select: { apiToken: true },
    })

    const apiToken = user?.apiToken ?? null
    return NextResponse.json({
      hasToken: Boolean(apiToken),
      maskedToken: apiToken ? `${apiToken.slice(0, 8)}…` : null,
    })
  } catch (error) {
    console.error("GET /api/user/api-token error:", error)
    return NextResponse.json(
      { error: "Erreur lors de la vérification du token API" },
      { status: 500 }
    )
  }
}

// POST /api/user/api-token - Générer un nouveau token
export async function POST() {
  const { error, session } = await requireAuthApi()
  if (error) return error

  try {
    // Générer un token aléatoire avec préfixe glb_
    const token = `glb_${randomBytes(24).toString("hex")}`

    // Mettre à jour l'utilisateur avec le nouveau token
    const user = await prisma.user.update({
      where: { id: session!.user.id },
      data: { apiToken: token },
      select: { apiToken: true },
    })

    return NextResponse.json({
      token: user.apiToken,
    })
  } catch (error) {
    console.error("POST /api/user/api-token error:", error)
    return NextResponse.json(
      { error: "Erreur lors de la génération du token API" },
      { status: 500 }
    )
  }
}

// DELETE /api/user/api-token - Révoquer le token
export async function DELETE() {
  const { error, session } = await requireAuthApi()
  if (error) return error

  try {
    await prisma.user.update({
      where: { id: session!.user.id },
      data: { apiToken: null },
    })

    return NextResponse.json({
      ok: true,
    })
  } catch (error) {
    console.error("DELETE /api/user/api-token error:", error)
    return NextResponse.json(
      { error: "Erreur lors de la révocation du token API" },
      { status: 500 }
    )
  }
}