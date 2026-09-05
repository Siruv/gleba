/**
 * Route MCP (Model Context Protocol) - Point d'entrée partagé
 * Authentification par bearer token, utilisé par :
 * 1. Les connexions MCP externes (Claude Desktop, etc.)
 * 2. Le tool-calling interne via la boucle de l'assistant
 */

import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { executerOutil } from "@/lib/chat-tools"

export const dynamic = "force-dynamic"

// POST /api/mcp
export async function POST(request: NextRequest) {
  try {
    // Extraire le token d'authentification
    const authHeader = request.headers.get("Authorization")
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Token d'authentification requis" },
        { status: 401 }
      )
    }

    const token = authHeader.slice("Bearer ".length).trim()
    if (token === "") {
      return NextResponse.json(
        { error: "Token d'authentification invalide" },
        { status: 401 }
      )
    }

    // Valider le token et récupérer l'utilisateur
    const user = await prisma.user.findFirst({
      where: { apiToken: token },
      select: { id: true },
    })

    if (!user) {
      return NextResponse.json(
        { error: "Token invalide." },
        { status: 401 }
      )
    }

    // Lire le body JSON
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "Corps JSON invalide" },
        { status: 400 }
      )
    }

    if (
      typeof body !== "object" ||
      body === null ||
      !("tool" in body) ||
      typeof body.tool !== "string" ||
      body.tool.trim() === ""
    ) {
      return NextResponse.json(
        { error: "Le champ 'tool' est requis et doit être une chaîne non vide" },
        { status: 400 }
      )
    }

    const tool = body.tool.trim()
    const args = (body as { args?: unknown }).args

    // Exécuter l'outil
    const resultatString = await executerOutil(tool, JSON.stringify(args ?? {}), user.id)
    
    // Parser le résultat pour le retourner au format attendu
    try {
      const resultat = JSON.parse(resultatString)
      return NextResponse.json({ result: resultat })
    } catch {
      return NextResponse.json(
        { error: "Erreur lors du traitement du résultat" },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error("POST /api/mcp error:", error)
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}