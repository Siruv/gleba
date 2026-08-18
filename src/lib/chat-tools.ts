/**
 * Outils partagés pour le tool-calling du chat IA
 * Ces outils sont utilisés à la fois par :
 * 1. La boucle de tool-calling interne (provider openai-codex)
 * 2. La route /api/mcp pour les connexions MCP externes
 */

import prisma from "@/lib/prisma"
import { fetchOpenMeteoForecast } from "@/lib/meteo"

// ============================================================
// INTERFACES
// ============================================================

export interface OutilChat {
  name: string
  description: string
  parameters: Record<string, unknown>
  handler: (args: Record<string, unknown>, userId: string) => Promise<unknown>
}

// ============================================================
// OUTILS DISPONIBLES
// ============================================================

export const outilsChat: OutilChat[] = [
  {
    name: "get_meteo_parcelles",
    description: "Récupère les données météo actuelles et les prévisions pour toutes les parcelles de l'utilisateur",
    parameters: {},
    handler: async (args: Record<string, unknown>, userId: string) => {
      try {
        const parcelles = await prisma.parcelleGeo.findMany({
          where: {
            userId,
            centroidLat: { not: null },
            centroidLng: { not: null },
          },
          select: {
            id: true,
            nom: true,
            centroidLat: true,
            centroidLng: true,
          },
          orderBy: { nom: "asc" },
          take: 5,
        })

        if (parcelles.length === 0) {
          return { parcelles: [] }
        }

        const parcellesAvecMeteo = await Promise.all(
          parcelles.map(async (parcelle) => {
            try {
              const forecast = await fetchOpenMeteoForecast(parcelle.centroidLat!, parcelle.centroidLng!)
              
              return {
                nom: parcelle.nom,
                actuelle: forecast.current
                  ? {
                      temperature: Math.round(forecast.current.temperature),
                      description: forecast.current.weatherDescription,
                      humidite: forecast.current.humidity,
                      vent: forecast.current.windSpeed,
                    }
                  : null,
                previsions: forecast.daily.map((jour) => ({
                  date: jour.date,
                  tempMin: Math.round(jour.tempMin),
                  tempMax: Math.round(jour.tempMax),
                  precipitation: jour.precipitation,
                  precipitationProba: jour.precipitationProba,
                })),
              }
            } catch {
              return null
            }
          })
        )

        const parcellesFiltrees = parcellesAvecMeteo.filter((p): p is NonNullable<typeof p> => p !== null)
        return { parcelles: parcellesFiltrees }
      } catch (error) {
        return { erreur: "Impossible de récupérer les données météo" }
      }
    },
  },
  {
    name: "get_cultures",
    description: "Récupère la liste des cultures de l'utilisateur avec filtres optionnels",
    parameters: {
      type: "object",
      properties: {
        annee: { type: "number", description: "Année de culture" },
        espece: { type: "string", description: "ID de l'espèce" },
        etat: { type: "string", description: "État de la culture (Planifiée, Semée, Plantée, En récolte, Terminée)" },
      },
    },
    handler: async (args: Record<string, unknown>, userId: string) => {
      try {
        const where: any = { userId }
        
        if (args.annee) {
          where.annee = Number(args.annee)
        }
        
        if (args.espece) {
          where.especeId = String(args.espece)
        }
        
        if (args.etat) {
          const etat = String(args.etat)
          switch (etat) {
            case "Planifiée":
              where.semisFait = false
              where.terminee = null
              break
            case "Semée":
              where.semisFait = true
              where.plantationFaite = false
              where.terminee = null
              break
            case "Plantée":
              where.plantationFaite = true
              where.recolteFaite = false
              where.terminee = null
              break
            case "En récolte":
              where.recolteFaite = true
              where.terminee = null
              break
            case "Terminée":
              where.terminee = { not: null }
              break
          }
        }

        const cultures = await prisma.culture.findMany({
          where,
          include: {
            espece: { select: { nom: true } },
            variete: { select: { nom: true } },
            planche: { select: { nom: true } },
          },
          orderBy: [{ annee: "desc" }, { id: "desc" }],
          take: 50,
        })

        return cultures.map((culture) => ({
          id: culture.id,
          espece: culture.espece?.nom,
          variete: culture.variete?.nom,
          planche: culture.planche?.nom,
          annee: culture.annee,
          etat: culture.terminee
            ? "Terminée"
            : culture.recolteFaite
              ? "En récolte"
              : culture.plantationFaite
                ? "Plantée"
                : culture.semisFait
                  ? "Semée"
                  : "Planifiée",
          dateSemis: culture.dateSemis,
          datePlantation: culture.datePlantation,
          dateRecolte: culture.dateRecolte,
          notes: culture.notes,
        }))
      } catch (error) {
        return { erreur: "Impossible de récupérer les cultures" }
      }
    },
  },
  {
    name: "get_planches",
    description: "Récupère la liste des planches de culture de l'utilisateur",
    parameters: {
      type: "object",
      properties: {
        search: { type: "string", description: "Terme de recherche dans le nom ou l'ilot" },
      },
    },
    handler: async (args: Record<string, unknown>, userId: string) => {
      try {
        const where: any = { userId }
        
        if (args.search) {
          where.OR = [
            { nom: { contains: String(args.search), mode: "insensitive" } },
            { ilot: { contains: String(args.search), mode: "insensitive" } },
          ]
        }

        const planches = await prisma.planche.findMany({
          where,
          orderBy: { nom: "asc" },
          take: 50,
        })

        return planches.map((planche) => ({
          id: planche.id,
          nom: planche.nom,
          ilot: planche.ilot,
          type: planche.type,
          largeur: planche.largeur,
          longueur: planche.longueur,
        }))
      } catch (error) {
        return { erreur: "Impossible de récupérer les planches" }
      }
    },
  },
  {
    name: "get_recoltes",
    description: "Récupère la liste des récoltes de l'utilisateur",
    parameters: {
      type: "object",
      properties: {
        annee: { type: "number", description: "Année de récolte" },
        espece: { type: "string", description: "ID de l'espèce" },
        limit: { type: "number", description: "Nombre maximum de résultats" },
      },
    },
    handler: async (args: Record<string, unknown>, userId: string) => {
      try {
        const where: any = { userId }
        
        if (args.annee) {
          const annee = Number(args.annee)
          where.date = {
            gte: new Date(annee, 0, 1),
            lt: new Date(annee + 1, 0, 1),
          }
        }
        
        if (args.espece) {
          where.especeId = String(args.espece)
        }

        const limit = args.limit ? Math.min(Number(args.limit), 100) : 30

        const recoltes = await prisma.recolte.findMany({
          where,
          include: {
            espece: { select: { nom: true } },
          },
          orderBy: { date: "desc" },
          take: limit,
        })

        return recoltes.map((recolte) => ({
          date: recolte.date,
          espece: recolte.espece?.nom,
          quantiteKg: recolte.quantite,
          statut: recolte.statut,
        }))
      } catch (error) {
        return { erreur: "Impossible de récupérer les récoltes" }
      }
    },
  },
  {
    name: "get_especes",
    description: "Récupère la liste des espèces disponibles dans le catalogue",
    parameters: {
      type: "object",
      properties: {
        search: { type: "string", description: "Terme de recherche dans le nom" },
        type: { type: "string", description: "Type d'espèce (legume, aromatique, etc.)" },
      },
    },
    handler: async (args: Record<string, unknown>, userId: string) => {
      try {
        const where: any = {}
        
        if (args.search) {
          where.nom = { contains: String(args.search), mode: "insensitive" }
        }
        
        if (args.type) {
          where.type = String(args.type)
        }

        const especes = await prisma.espece.findMany({
          where,
          orderBy: { nom: "asc" },
          take: 30,
        })

        return especes.map((espece) => ({
          id: espece.id,
          nom: espece.nom,
          famille: espece.familleId,
          type: espece.type,
        }))
      } catch (error) {
        return { erreur: "Impossible de récupérer les espèces" }
      }
    },
  },
  {
    name: "get_stocks",
    description: "Récupère les stocks de semences et fertilisants de l'utilisateur",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["semences", "fertilisants"], description: "Type de stock" },
      },
    },
    handler: async (args: Record<string, unknown>, userId: string) => {
      try {
        const type = args.type === "fertilisants" ? "fertilisants" : "semences"
        
        if (type === "semences") {
          const stocks = await prisma.userStockVariete.findMany({
            where: { userId },
            include: {
              variete: {
                include: {
                  espece: { select: { nom: true } },
                },
              },
            },
            take: 50,
          })

          return {
            semences: stocks.map((stock) => ({
              espece: stock.variete?.espece?.nom,
              variete: stock.variete?.nom,
              quantite: stock.stockGraines,
              unite: stock.uniteStock || "graines",
            })),
          }
        } else {
          const stocks = await prisma.userStockFertilisant.findMany({
            where: { userId },
            take: 50,
          })

          return {
            fertilisants: stocks.map((stock) => ({
              nom: stock.fertilisantId, // Using ID as name since we don't have direct access to fertilisant
              quantite: stock.stock,
              unite: "kg",
            })),
          }
        }
      } catch (error) {
        return { erreur: "Impossible de récupérer les stocks" }
      }
    },
  },
  {
    name: "get_planification",
    description: "Récupère la planification (ITP) pour une année donnée",
    parameters: {
      type: "object",
      properties: {
        annee: { type: "number", description: "Année de planification" },
      },
    },
    handler: async (args: Record<string, unknown>, userId: string) => {
      try {
        const annee = args.annee ? Number(args.annee) : new Date().getFullYear()
        
        const itps = await prisma.iTP.findMany({
          where: { userId },
          include: {
            espece: { select: { nom: true } },
          },
          orderBy: { semaineSemis: "asc" },
        })

        return itps.map((itp) => ({
          id: itp.id,
          espece: itp.espece?.nom,
          semaineSemis: itp.semaineSemis,
          semainePlantation: itp.semainePlantation,
          semaineRecolte: itp.semaineRecolte,
          dureeCulture: itp.dureeCulture,
        }))
      } catch (error) {
        return { erreur: "Impossible de récupérer la planification" }
      }
    },
  },
  {
    name: "get_dashboard_stats",
    description: "Récupère les statistiques principales du tableau de bord",
    parameters: {},
    handler: async (args: Record<string, unknown>, userId: string) => {
      try {
        const now = new Date()
        const startOfWeek = new Date(now)
        startOfWeek.setDate(now.getDate() - now.getDay())
        const startOfYear = new Date(now.getFullYear(), 0, 1)

        const [culturesActives, surfaceCultivee, recoltesAnnee, tachesSemaine] = await Promise.all([
          prisma.culture.count({
            where: {
              userId,
              terminee: null,
            },
          }),
          prisma.planche.aggregate({
            where: { userId },
            _sum: { surface: true },
          }),
          prisma.recolte.aggregate({
            where: {
              userId,
              date: { gte: startOfYear },
            },
            _sum: { quantite: true },
          }),
          prisma.culture.count({
            where: {
              userId,
              terminee: null,
              OR: [
                { aFaire: { not: null } },
                { aIrriguer: true },
              ],
            },
          }),
        ])

        return {
          culturesActives,
          surfaceCultivee: surfaceCultivee._sum.surface || 0,
          recoltesAnneeKg: recoltesAnnee._sum.quantite || 0,
          tachesSemaine,
        }
      } catch (error) {
        return { erreur: "Impossible de récupérer les statistiques" }
      }
    },
  },
]

// ============================================================
// FONCTIONS D'EXPORT
// ============================================================

/**
 * Retourne la liste des outils au format attendu par le backend Codex
 */
export function outilsPourBackend(): Array<{
  type: "function"
  name: string
  description: string
  parameters: Record<string, unknown>
}> {
  return outilsChat.map((outil) => ({
    type: "function",
    name: outil.name,
    description: outil.description,
    parameters: outil.parameters,
  }))
}

/**
 * Exécute un outil par son nom et retourne le résultat sous forme de chaîne JSON
 */
export async function executerOutil(
  name: string,
  argsJson: string,
  userId: string
): Promise<string> {
  try {
    const args = argsJson ? JSON.parse(argsJson) : {}
    const outil = outilsChat.find((o) => o.name === name)
    
    if (!outil) {
      return JSON.stringify({ erreur: `Outil inconnu : ${name}` })
    }
    
    const resultat = await outil.handler(args, userId)
    return JSON.stringify(resultat)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return JSON.stringify({ erreur: message })
  }
}