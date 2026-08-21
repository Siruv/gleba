/**
 * Outils partagés pour le tool-calling du chat IA
 * Ces outils sont utilisés à la fois par :
 * 1. La boucle de tool-calling interne (provider openai-codex)
 * 2. La route /api/mcp pour les connexions MCP externes
 */

import prisma from "@/lib/prisma"
import { fetchOpenMeteoForecast } from "@/lib/meteo"
import type { Prisma } from "@prisma/client"
import { createPlancheSchema } from "@/lib/validations/planche"
import { createVarieteSchema } from "@/lib/validations/variete"
import { cleanReferentielName, normalizeVarieteName } from "@/lib/normalize"
import { attributionCreation } from "@/lib/referentiel-communaute"
import { invalidateKpi } from "@/lib/kpi"

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
  {
    name: "create_planche",
    description: "Crée une nouvelle planche de culture. Supprime définitivement les données existantes si une planche du même nom existe déjà.",
    parameters: {
      type: "object",
      properties: {
        nom: { type: "string", description: "Nom de la planche (obligatoire)" },
        largeur: { type: "number", description: "Largeur en mètres" },
        longueur: { type: "number", description: "Longueur en mètres" },
        surface: { type: "number", description: "Surface en m² (calculée automatiquement si largeur et longueur sont fournies)" },
        type: { type: "string", description: "Type de planche (Serre, Plein champ, Tunnel, Chassis)" },
        irrigation: { type: "string", description: "Type d'irrigation" },
        ilot: { type: "string", description: "Nom de l'ilot ou de la parcelle" },
        parcelleGeoId: { type: "string", description: "ID de la parcelle géographique" },
        notes: { type: "string", description: "Notes supplémentaires" },
        posX: { type: "number", description: "Position X pour le placement" },
        posY: { type: "number", description: "Position Y pour le placement" },
      },
      required: ["nom"],
    },
    handler: async (args: Record<string, unknown>, userId: string) => {
      try {
        const validation = createPlancheSchema.safeParse(args)
        if (!validation.success) {
          return { erreur: validation.error.issues.map((e) => e.message).join(", ") }
        }

        const nom = String(args.nom)
        const existante = await prisma.planche.findUnique({
          where: { nom_userId: { nom, userId } },
        })
        if (existante) {
          return { erreur: `La planche "${nom}" existe déjà.` }
        }

        const largeur = args.largeur !== undefined ? Number(args.largeur) : null
        const longueur = args.longueur !== undefined ? Number(args.longueur) : null
        let surface = args.surface !== undefined ? Number(args.surface) : null
        if (largeur !== null && longueur !== null && largeur > 0 && longueur > 0) {
          surface = largeur * longueur
        }

        const data: Record<string, unknown> = {
          nom,
          userId,
          surface,
        }
        if (args.type) data.type = String(args.type)
        if (args.irrigation) data.irrigation = String(args.irrigation)
        if (args.ilot) data.ilot = String(args.ilot)
        if (args.parcelleGeoId) data.parcelleGeoId = String(args.parcelleGeoId)
        if (args.notes) data.notes = String(args.notes)
        if (args.posX !== undefined) data.posX = Number(args.posX)
        if (args.posY !== undefined) data.posY = Number(args.posY)

        const planche = await prisma.planche.create({
          data: data as never,
        })

        await invalidateKpi(userId)
        return { succes: true, planche: { id: planche.id, nom: planche.nom, surface: planche.surface, type: planche.type, ilot: planche.ilot } }
      } catch (caughtError) {
        const message = caughtError instanceof Error ? caughtError.message : String(caughtError)
        return { erreur: `Impossible de créer la planche : ${message}` }
      }
    },
  },
  {
    name: "delete_planche",
    description: "Supprime définitivement une planche de culture par son nom. Vérifie qu'aucune culture n'est liée avant suppression.",
    parameters: {
      type: "object",
      properties: {
        nom: { type: "string", description: "Nom de la planche à supprimer (obligatoire)" },
      },
      required: ["nom"],
    },
    handler: async (args: Record<string, unknown>, userId: string) => {
      try {
        const nom = String(args.nom)
        const planche = await prisma.planche.findUnique({
          where: { nom_userId: { nom, userId } },
          include: { _count: { select: { cultures: true } } },
        })
        if (!planche) {
          return { erreur: `Planche "${nom}" non trouvée.` }
        }
        if (planche._count.cultures > 0) {
          return { erreur: `Impossible de supprimer la planche "${nom}" car elle a ${planche._count.cultures} culture(s) liée(s).` }
        }
        await prisma.planche.delete({ where: { id: planche.id } })
        await invalidateKpi(userId)
        return { succes: true, supprimee: nom }
      } catch (caughtError) {
        const message = caughtError instanceof Error ? caughtError.message : String(caughtError)
        return { erreur: `Impossible de supprimer la planche : ${message}` }
      }
    },
  },
  {
    name: "create_objet_jardin",
    description: "Crée un nouvel objet dans le jardin (allée, passage, bordure, serre, compost, etc.).",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", description: "Type d'objet (allee, passage, bordure, serre, compost, autre)", enum: ["allee", "passage", "bordure", "serre", "compost", "autre"] },
        nom: { type: "string", description: "Nom de l'objet" },
        largeur: { type: "number", description: "Largeur en mètres (obligatoire)" },
        longueur: { type: "number", description: "Longueur en mètres (obligatoire)" },
        posX: { type: "number", description: "Position X (obligatoire)" },
        posY: { type: "number", description: "Position Y (obligatoire)" },
        parcelleGeoId: { type: "string", description: "ID de la parcelle géographique" },
        couleur: { type: "string", description: "Couleur de l'objet" },
        notes: { type: "string", description: "Notes supplémentaires" },
      },
      required: ["type", "largeur", "longueur", "posX", "posY"],
    },
    handler: async (args: Record<string, unknown>, userId: string) => {
      try {
        const type = String(args.type)
        const typesValides = ["allee", "passage", "bordure", "serre", "compost", "autre"]
        if (!typesValides.includes(type)) {
          return { erreur: `Type d'objet invalide : "${type}". Types acceptés : ${typesValides.join(", ")}.` }
        }
        const largeur = Number(args.largeur)
        const longueur = Number(args.longueur)
        const posX = Number(args.posX)
        const posY = Number(args.posY)
        if (largeur <= 0 || longueur <= 0) {
          return { erreur: "Largeur et longueur doivent être positives." }
        }
        const data: Record<string, unknown> = {
          type,
          largeur,
          longueur,
          posX,
          posY,
          userId,
        }
        if (args.nom) data.nom = String(args.nom)
        if (args.parcelleGeoId) data.parcelleGeoId = String(args.parcelleGeoId)
        if (args.couleur) data.couleur = String(args.couleur)
        if (args.notes) data.notes = String(args.notes)
        const objet = await prisma.objetJardin.create({ data: data as never })
        return { succes: true, objet: { id: objet.id, nom: objet.nom, type: objet.type, largeur: objet.largeur, longueur: objet.longueur } }
      } catch (caughtError) {
        const message = caughtError instanceof Error ? caughtError.message : String(caughtError)
        return { erreur: `Impossible de créer l'objet jardin : ${message}` }
      }
    },
  },
  {
    name: "delete_objet_jardin",
    description: "Supprime définitivement un objet du jardin par son ID.",
    parameters: {
      type: "object",
      properties: {
        objetId: { type: "number", description: "ID de l'objet à supprimer (obligatoire)" },
      },
      required: ["objetId"],
    },
    handler: async (args: Record<string, unknown>, userId: string) => {
      try {
        const objetId = Number(args.objetId)
        const objet = await prisma.objetJardin.findUnique({ where: { id: objetId, userId } })
        if (!objet) {
          return { erreur: "Objet non trouvé." }
        }
        await prisma.objetJardin.delete({ where: { id: objetId } })
        return { succes: true }
      } catch (caughtError) {
        const message = caughtError instanceof Error ? caughtError.message : String(caughtError)
        return { erreur: `Impossible de supprimer l'objet jardin : ${message}` }
      }
    },
  },
  {
    name: "create_variete_perso",
    description: "Crée une nouvelle variété personnelle pour une espèce donnée. Supprime définitivement les données existantes si une variété du même nom existe déjà pour cette espèce.",
    parameters: {
      type: "object",
      properties: {
        nom: { type: "string", description: "Nom de la variété (obligatoire)" },
        especeNom: { type: "string", description: "Nom de l'espèce parente (ex: Tomate) (obligatoire)" },
        bio: { type: "boolean", description: "Variété bio" },
        description: { type: "string", description: "Description de la variété" },
        semaineRecolte: { type: "number", description: "Semaine de récolte" },
        dureeRecolte: { type: "number", description: "Durée de récolte en semaines" },
      },
      required: ["nom", "especeNom"],
    },
    handler: async (args: Record<string, unknown>, userId: string) => {
      try {
        const especeNom = String(args.especeNom)
        const resolution = await resoudreEspeceParNom(especeNom, userId)
        if (resolution.erreur) {
          return { erreur: resolution.erreur }
        }
        const especeId = resolution.especeId!
        const nomSaisi = cleanReferentielName(String(args.nom))
        const nomNormalise = normalizeVarieteName(nomSaisi)
        const existante = await prisma.variete.findFirst({
          where: { especeId, nomNormalise, userId },
        })
        if (existante) {
          return { erreur: `La variété "${nomSaisi}" existe déjà pour l'espèce "${especeNom}".` }
        }
        const data: Record<string, unknown> = {
          nom: nomSaisi,
          nomNormalise,
          especeId,
          userId,
          partageCommunaute: false,
        }
        if (args.bio === true) data.bio = true
        if (args.description) data.description = String(args.description)
        if (args.semaineRecolte !== undefined) data.semaineRecolte = Number(args.semaineRecolte)
        if (args.dureeRecolte !== undefined) data.dureeRecolte = Number(args.dureeRecolte)
        const variete = await prisma.variete.create({ data: data as never })
        return { succes: true, variete: { id: variete.id, nom: variete.nom, especeId: variete.especeId } }
      } catch (caughtError) {
        const message = caughtError instanceof Error ? caughtError.message : String(caughtError)
        return { erreur: `Impossible de créer la variété : ${message}` }
      }
    },
  },
  {
    name: "delete_variete_perso",
    description: "Supprime définitivement une variété personnelle par son ID. Vérifie que l'utilisateur est bien le propriétaire.",
    parameters: {
      type: "object",
      properties: {
        varieteId: { type: "string", description: "ID de la variété à supprimer (obligatoire)" },
      },
      required: ["varieteId"],
    },
    handler: async (args: Record<string, unknown>, userId: string) => {
      try {
        const varieteId = String(args.varieteId)
        const variete = await prisma.variete.findUnique({ where: { id: varieteId } })
        if (!variete) {
          return { erreur: "Variété non trouvée." }
        }
        if (variete.userId !== userId) {
          return { erreur: "Vous ne pouvez supprimer que vos propres variétés." }
        }
        await prisma.variete.delete({ where: { id: varieteId } })
        return { succes: true }
      } catch (caughtError) {
        const message = caughtError instanceof Error ? caughtError.message : String(caughtError)
        return { erreur: `Impossible de supprimer la variété : ${message}` }
      }
    },
  },
  {
    name: "delete_culture",
    description: "Supprime définitivement une culture par son ID. Supprime également les ventes automatiques liées aux récoltes de cette culture.",
    parameters: {
      type: "object",
      properties: {
        cultureId: { type: "number", description: "ID de la culture à supprimer (obligatoire)" },
      },
      required: ["cultureId"],
    },
    handler: async (args: Record<string, unknown>, userId: string) => {
      try {
        const cultureId = Number(args.cultureId)
        const culture = await prisma.culture.findUnique({ where: { id: cultureId, userId } })
        if (!culture) {
          return { erreur: "Culture non trouvée." }
        }
        const recoltes = await prisma.recolte.findMany({
          where: { cultureId, userId },
          select: { id: true },
        })
        await prisma.$transaction(async (tx) => {
          if (recoltes.length > 0) {
            await tx.venteManuelle.deleteMany({
              where: {
                sourceType: "recolte",
                sourceId: { in: recoltes.map((r) => r.id) },
                auto: true,
              },
            })
          }
          await tx.culture.delete({ where: { id: cultureId } })
        })
        return { succes: true, supprimee: cultureId }
      } catch (caughtError) {
        const message = caughtError instanceof Error ? caughtError.message : String(caughtError)
        return { erreur: `Impossible de supprimer la culture : ${message}` }
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