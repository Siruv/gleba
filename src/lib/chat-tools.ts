/**
 * Outils partagés pour le tool-calling du chat IA
 * Ces outils sont utilisés à la fois par :
 * 1. La boucle de tool-calling interne (provider openai-codex)
 * 2. La route /api/mcp pour les connexions MCP externes
 */

import prisma from "@/lib/prisma"
import { fetchOpenMeteoForecast } from "@/lib/meteo"
import type { Prisma } from "@prisma/client"

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
// HELPERS
// ============================================================

/**
 * Résout une espèce par son nom pour les outils d'écriture.
 * Cherche d'abord une correspondance exacte (insensible à la casse),
 * puis une correspondance partielle. Retourne l'id de l'espèce ou une erreur.
 */
async function resoudreEspeceParNom(
  nom: string,
  userId: string
): Promise<{ especeId?: string; erreur?: string }> {
  const nomRecherche = nom.trim()
  if (nomRecherche === "") {
    return { erreur: "Le nom de l'espèce est vide." }
  }

  // 1. Correspondance exacte (insensible à la casse)
  const exactes = await prisma.espece.findMany({
    where: {
      nom: { equals: nomRecherche, mode: "insensitive" },
      OR: [{ userId }, { userId: null }],
    },
    select: { id: true, nom: true, userId: true },
    take: 5,
  })
  if (exactes.length === 1) {
    return { especeId: exactes[0].id }
  }
  if (exactes.length > 1) {
    // Priorité à l'espèce perso de l'utilisateur
    const perso = exactes.find((e) => e.userId === userId)
    if (perso) return { especeId: perso.id }
    return {
      erreur: `Plusieurs espèces correspondent à "${nomRecherche}". Précisez le nom exact.`,
    }
  }

  // 2. Correspondance partielle
  const partielles = await prisma.espece.findMany({
    where: {
      nom: { contains: nomRecherche, mode: "insensitive" },
      OR: [{ userId }, { userId: null }],
    },
    select: { id: true, nom: true, userId: true },
    take: 6,
  })
  if (partielles.length === 1) {
    return { especeId: partielles[0].id }
  }
  if (partielles.length > 1) {
    const suggestions = partielles.map((e) => e.nom).join(", ")
    return {
      erreur: `Plusieurs espèces correspondent à "${nomRecherche}" : ${suggestions}. Précisez le nom.`,
    }
  }

  return { erreur: `Aucune espèce trouvée pour "${nomRecherche}".` }
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
      } catch {
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
        const where: Prisma.CultureWhereInput = { userId }
        
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
      } catch {
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
        const where: Prisma.PlancheWhereInput = { userId }
        
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
      } catch {
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
        const where: Prisma.RecolteWhereInput = { userId }
        
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
      } catch {
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    handler: async (args: Record<string, unknown>, _userId: string) => {
      
      try {
        const where: Prisma.EspeceWhereInput = {}
        
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
      } catch {
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
            include: { fertilisant: true },
          })

          return {
            fertilisants: stocks.map((stock) => ({
              nom: stock.fertilisant?.id ?? stock.fertilisantId,
              quantite: stock.stock,
              unite: "kg",
            })),
          }
        }
      } catch {
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
      } catch {
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
      } catch {
        return { erreur: "Impossible de récupérer les statistiques" }
      }
    },
  },
  {
    name: "create_intervention",
    description:
      "Crée une tâche / intervention dans le jardin (semis, plantation, désherbage, arrosage, récolte, taille, etc.). Utilise cet outil quand l'utilisateur demande de créer, planifier ou enregistrer une tâche ou une action à faire.",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: [
            "semis",
            "plantation",
            "desherbage",
            "binage",
            "paillage",
            "traitement_phyto",
            "fertilisation",
            "recolte",
            "taille",
            "arrosage",
            "tuteurage",
            "autre",
          ],
          description: "Type d'intervention",
        },
        description: {
          type: "string",
          description: "Description de la tâche (ex: 'Arroser les tomates de la serre')",
        },
        date: {
          type: "string",
          description: "Date de l'intervention au format ISO (ex: '2026-08-20'). Si omis, la date du jour est utilisée.",
        },
        datePrevue: {
          type: "string",
          description: "Date prévue (pour une tâche à faire plus tard) au format ISO",
        },
        fait: {
          type: "boolean",
          description: "true si la tâche est déjà faite, false si elle est à faire (défaut: true)",
        },
        dureeMinutes: {
          type: "number",
          description: "Durée estimée ou passée en minutes",
        },
      },
      required: ["type"],
    },
    handler: async (args: Record<string, unknown>, userId: string) => {
      try {
        const type = String(args.type ?? "")
        const typesValides = [
          "semis", "plantation", "desherbage", "binage", "paillage",
          "traitement_phyto", "fertilisation", "recolte", "taille",
          "arrosage", "tuteurage", "autre",
        ]
        if (!typesValides.includes(type)) {
          return { erreur: `Type d'intervention invalide : "${type}". Types acceptés : ${typesValides.join(", ")}.` }
        }

        const donnees: Record<string, unknown> = {
          userId,
          type,
          fait: args.fait === undefined ? true : Boolean(args.fait),
        }
        if (args.description) donnees.description = String(args.description)
        if (args.date) {
          const dateParsee = new Date(String(args.date))
          if (!Number.isNaN(dateParsee.getTime())) donnees.date = dateParsee
        }
        if (args.datePrevue) {
          const datePrevueParsee = new Date(String(args.datePrevue))
          if (!Number.isNaN(datePrevueParsee.getTime())) donnees.datePrevue = datePrevueParsee
        }
        if (args.dureeMinutes !== undefined) {
          donnees.dureeMinutes = Number(args.dureeMinutes)
        }

        const intervention = await prisma.intervention.create({
          data: donnees as never,
        })

        return {
          succes: true,
          message: `Intervention "${type}" créée (id ${intervention.id}).`,
          intervention: {
            id: intervention.id,
            type: intervention.type,
            description: intervention.description,
            date: intervention.date,
            fait: intervention.fait,
          },
        }
      } catch (caughtError) {
        const message = caughtError instanceof Error ? caughtError.message : String(caughtError)
        return { erreur: `Impossible de créer l'intervention : ${message}` }
      }
    },
  },
  {
    name: "create_culture",
    description:
      "Crée une nouvelle culture (un semis ou une plantation planifié) pour une espèce donnée. Utilise cet outil quand l'utilisateur veut ajouter une culture, semer ou planter une espèce. L'espèce peut être donnée par son nom (ex: 'tomate') ou par son id.",
    parameters: {
      type: "object",
      properties: {
        especeNom: {
          type: "string",
          description: "Nom de l'espèce (ex: 'tomate', 'carotte'). Utilisé si especeId n'est pas fourni.",
        },
        especeId: {
          type: "string",
          description: "ID de l'espèce (si déjà connu). Prioritaire sur especeNom.",
        },
        annee: {
          type: "number",
          description: "Année de planification (ex: 2026). Si omis, l'année courante est utilisée.",
        },
        dateSemis: {
          type: "string",
          description: "Date du semis au format ISO (ex: '2026-08-20')",
        },
        datePlantation: {
          type: "string",
          description: "Date de plantation au format ISO",
        },
        dateRecolte: {
          type: "string",
          description: "Date de récolte prévue au format ISO",
        },
        quantite: {
          type: "number",
          description: "Surface (m²) ou nombre de plants",
        },
        semisFait: {
          type: "boolean",
          description: "true si le semis est déjà réalisé (défaut: false)",
        },
        plantationFaite: {
          type: "boolean",
          description: "true si la plantation est déjà réalisée (défaut: false)",
        },
      },
    },
    handler: async (args: Record<string, unknown>, userId: string) => {
      try {
        // Résolution de l'espèce
        let especeId = args.especeId ? String(args.especeId) : ""
        if (especeId === "") {
          const especeNom = args.especeNom ? String(args.especeNom) : ""
          if (especeNom === "") {
            return { erreur: "Indiquez l'espèce (especeNom ou especeId)." }
          }
          const resolution = await resoudreEspeceParNom(especeNom, userId)
          if (resolution.erreur) return { erreur: resolution.erreur }
          especeId = resolution.especeId!
        }

        const donnees: Record<string, unknown> = {
          userId,
          especeId,
          annee: args.annee !== undefined ? Number(args.annee) : new Date().getFullYear(),
          semisFait: args.semisFait === true,
          plantationFaite: args.plantationFaite === true,
        }
        if (args.dateSemis) {
          const d = new Date(String(args.dateSemis))
          if (!Number.isNaN(d.getTime())) donnees.dateSemis = d
        }
        if (args.datePlantation) {
          const d = new Date(String(args.datePlantation))
          if (!Number.isNaN(d.getTime())) donnees.datePlantation = d
        }
        if (args.dateRecolte) {
          const d = new Date(String(args.dateRecolte))
          if (!Number.isNaN(d.getTime())) donnees.dateRecolte = d
        }
        if (args.quantite !== undefined) {
          donnees.quantite = Number(args.quantite)
        }

        const culture = await prisma.culture.create({
          data: donnees as never,
          include: { espece: { select: { nom: true } } },
        })

        return {
          succes: true,
          message: `Culture "${culture.espece?.nom ?? especeId}" créée (id ${culture.id}).`,
          culture: {
            id: culture.id,
            espece: culture.espece?.nom ?? especeId,
            annee: culture.annee,
            dateSemis: culture.dateSemis,
            datePlantation: culture.datePlantation,
            semisFait: culture.semisFait,
            plantationFaite: culture.plantationFaite,
          },
        }
      } catch (caughtError) {
        const message = caughtError instanceof Error ? caughtError.message : String(caughtError)
        return { erreur: `Impossible de créer la culture : ${message}` }
      }
    },
  },
  {
    name: "update_culture",
    description:
      "Met à jour l'état d'une culture existante : marquer le semis fait, la plantation faite, la récolte faite, ou modifier les dates et quantités. Utilise cet outil quand l'utilisateur dit qu'il a semé, planté ou récolté, ou qu'il veut corriger une culture.",
    parameters: {
      type: "object",
      properties: {
        cultureId: {
          type: "number",
          description: "ID de la culture à mettre à jour (obligatoire)",
        },
        semisFait: {
          type: "boolean",
          description: "true pour marquer le semis comme fait",
        },
        plantationFaite: {
          type: "boolean",
          description: "true pour marquer la plantation comme faite",
        },
        recolteFaite: {
          type: "boolean",
          description: "true pour marquer la récolte comme faite",
        },
        dateSemis: { type: "string", description: "Nouvelle date de semis au format ISO" },
        datePlantation: { type: "string", description: "Nouvelle date de plantation au format ISO" },
        dateRecolte: { type: "string", description: "Nouvelle date de récolte au format ISO" },
        quantite: { type: "number", description: "Nouvelle quantité (surface m² ou nb plants)" },
      },
      required: ["cultureId"],
    },
    handler: async (args: Record<string, unknown>, userId: string) => {
      try {
        const cultureId = Number(args.cultureId)
        if (!Number.isFinite(cultureId) || cultureId <= 0) {
          return { erreur: "cultureId invalide." }
        }

        // Vérifier que la culture appartient bien à l'utilisateur
        const existante = await prisma.culture.findFirst({
          where: { id: cultureId, userId },
          select: { id: true },
        })
        if (!existante) {
          return { erreur: `Culture ${cultureId} introuvable ou n'appartient pas à l'utilisateur.` }
        }

        const donnees: Record<string, unknown> = {}
        if (args.semisFait !== undefined) donnees.semisFait = Boolean(args.semisFait)
        if (args.plantationFaite !== undefined) donnees.plantationFaite = Boolean(args.plantationFaite)
        if (args.recolteFaite !== undefined) donnees.recolteFaite = Boolean(args.recolteFaite)
        if (args.quantite !== undefined) donnees.quantite = Number(args.quantite)
        for (const [cle, valeur] of Object.entries({
          dateSemis: args.dateSemis,
          datePlantation: args.datePlantation,
          dateRecolte: args.dateRecolte,
        })) {
          if (valeur) {
            const d = new Date(String(valeur))
            if (!Number.isNaN(d.getTime())) donnees[cle] = d
          }
        }

        if (Object.keys(donnees).length === 0) {
          return { erreur: "Aucun champ à mettre à jour." }
        }

        const culture = await prisma.culture.update({
          where: { id: cultureId },
          data: donnees as never,
          include: { espece: { select: { nom: true } } },
        })

        return {
          succes: true,
          message: `Culture "${culture.espece?.nom ?? ""}" (id ${culture.id}) mise à jour.`,
          culture: {
            id: culture.id,
            espece: culture.espece?.nom,
            semisFait: culture.semisFait,
            plantationFaite: culture.plantationFaite,
            recolteFaite: culture.recolteFaite,
            dateSemis: culture.dateSemis,
            datePlantation: culture.datePlantation,
            dateRecolte: culture.dateRecolte,
          },
        }
      } catch (caughtError) {
        const message = caughtError instanceof Error ? caughtError.message : String(caughtError)
        return { erreur: `Impossible de mettre à jour la culture : ${message}` }
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
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : String(caughtError)
    return JSON.stringify({ erreur: message })
  }
}