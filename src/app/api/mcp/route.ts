/**
 * Route MCP (Model Context Protocol) - point d'entrée par jeton porteur.
 *
 * Contrat public d'upstream (docs/integrations-elevage.md, section
 * Authentification, et api/public/elevage-openapi/route.ts, entrée "/api/mcp") :
 * - jeton `Authorization: Bearer glb_…` créé depuis Paramètres > API ;
 * - GET liste les outils, POST exécute `{ tool, args, section? }` ;
 * - réponses 200, 400, 401, 429 ; 200 requêtes par tranche de 15 minutes et par jeton.
 *
 * Choix du plugin : MODE LECTURE SEULE. Seuls les outils `get_*` sont
 * exécutables ; tout autre outil répond 403. Les outils d'écriture du plugin
 * n'appliquent pas les règles métier d'upstream (audit, phase 2c) et ce chemin
 * n'a ni session ni confirmation côté client.
 */

import { createHash, timingSafeEqual } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { resoudreContexteExploitation } from "@/lib/exploitation/membres"
import { checkRateLimit, getClientIP } from "@/lib/rate-limit"
import { executerOutil, outilsChat } from "@/lib/chat-tools"

export const dynamic = "force-dynamic"

const PREFIXE_JETON = "glb_"
const FENETRE_MS = 15 * 60 * 1000
const MAX_PAR_JETON = 200

function empreinte(valeur: string): string {
  return createHash("sha256").update(valeur).digest("hex")
}

/** Comparaison en temps constant, sur des empreintes de longueur fixe. */
function jetonsEgaux(fourni: string, attendu: string): boolean {
  return timingSafeEqual(createHash("sha256").update(fourni).digest(), createHash("sha256").update(attendu).digest())
}

const reponse401 = () => NextResponse.json({ error: "Jeton invalide ou manquant." }, { status: 401 })

/**
 * Authentifie le jeton porteur et applique la limite de débit.
 * Retourne soit une réponse d'erreur, soit l'acteur et le tenant.
 */
async function authentifier(
  request: NextRequest
): Promise<{ erreur: NextResponse } | { tenantId: string }> {
  const entete = request.headers.get("Authorization")
  const jeton = entete?.startsWith("Bearer ") ? entete.slice("Bearer ".length).trim() : ""

  // Les tentatives avec un jeton invalide comptent par IP (anti-devinette).
  const refuser = () => {
    const limite = checkRateLimit(`mcp:echec:${getClientIP(request)}`, { windowMs: FENETRE_MS, max: MAX_PAR_JETON })
    return { erreur: limite ?? reponse401() }
  }

  if (!jeton.startsWith(PREFIXE_JETON)) return refuser()

  const utilisateur = await prisma.user.findUnique({
    where: { apiToken: jeton },
    select: { id: true, apiToken: true },
  })
  if (!utilisateur?.apiToken || !jetonsEgaux(jeton, utilisateur.apiToken)) return refuser()

  // Clé dérivée d'un hachage : le jeton n'apparaît jamais en clair.
  const limite = checkRateLimit(`mcp:${empreinte(jeton)}`, { windowMs: FENETRE_MS, max: MAX_PAR_JETON })
  if (limite) return { erreur: limite }

  const contexte = await resoudreContexteExploitation(utilisateur.id)
  return { tenantId: contexte.tenantId }
}

function outilsLecture() {
  return outilsChat.filter((o) => o.name.startsWith("get_"))
}

// GET /api/mcp : liste des outils exécutables
export async function GET(request: NextRequest) {
  try {
    const auth = await authentifier(request)
    if ("erreur" in auth) return auth.erreur
    return NextResponse.json({
      tools: outilsLecture().map((o) => ({ name: o.name, description: o.description, parameters: o.parameters })),
    })
  } catch (error) {
    console.error("GET /api/mcp error:", error)
    return NextResponse.json({ error: "Erreur interne." }, { status: 500 })
  }
}

// POST /api/mcp : exécution d'un outil de lecture
export async function POST(request: NextRequest) {
  try {
    const auth = await authentifier(request)
    if ("erreur" in auth) return auth.erreur

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 })
    }

    const corps = (typeof body === "object" && body !== null ? body : {}) as { tool?: unknown; args?: unknown; section?: unknown }
    if (typeof corps.tool !== "string" || corps.tool.trim() === "") {
      return NextResponse.json({ error: "Le champ 'tool' est requis et doit être une chaîne non vide" }, { status: 400 })
    }
    if (corps.section !== undefined && corps.section !== null && (typeof corps.section !== "string" || corps.section.length > 100)) {
      return NextResponse.json({ error: "La section doit être une chaîne de 100 caractères maximum" }, { status: 400 })
    }
    if (corps.args !== undefined && corps.args !== null && (typeof corps.args !== "object" || Array.isArray(corps.args))) {
      return NextResponse.json({ error: "Le champ 'args' doit être un objet" }, { status: 400 })
    }

    const tool = corps.tool.trim()
    if (!tool.startsWith("get_")) {
      return NextResponse.json(
        { error: "Accès en lecture seule : les outils d'écriture ne sont pas disponibles via MCP." },
        { status: 403 }
      )
    }
    if (!outilsLecture().some((o) => o.name === tool)) {
      return NextResponse.json({ error: "Outil inconnu." }, { status: 400 })
    }

    const resultatString = await executerOutil(tool, JSON.stringify(corps.args ?? {}), auth.tenantId)
    try {
      return NextResponse.json({ result: JSON.parse(resultatString) })
    } catch {
      return NextResponse.json({ error: "Erreur lors du traitement du résultat" }, { status: 500 })
    }
  } catch (error) {
    console.error("POST /api/mcp error:", error)
    return NextResponse.json({ error: "Erreur interne." }, { status: 500 })
  }
}
