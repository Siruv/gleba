/**
 * Outils partagés pour le tool-calling du chat IA
 * Ces outils sont utilisés à la fois par :
 * 1. La boucle de tool-calling interne (provider openai-codex)
 * 2. La route /api/mcp pour les connexions MCP externes
 */

import { AsyncLocalStorage } from "node:async_hooks"
import prisma from "@/lib/prisma"
import { visibiliteReferentiel } from "@/lib/referentiel-communaute"
import { whereItpApplicable, whereItpUtilisable } from "@/lib/itp-acces"
import { masquerReferentielsEmbarques } from "@/lib/referentiel-embarque"
import { appliquerDecalageItp, decalageItpPourLecteur } from "@/lib/calendrier-climat"
import { zoneEffectiveUser } from "@/lib/terroir"
import { ETATS_CULTURE, estEtatCulture, etatCulture, whereEtatCulture } from "@/lib/cultures/etat"
import { lireAnnee } from "@/lib/api/annee"
import { getKpiMaraichage } from "@/lib/kpi"
import { fetchOpenMeteoForecast } from "@/lib/meteo"
import type { Prisma } from "@prisma/client"
import { jourLocalISO } from "@/lib/jour-civil"
import { appelerRouteUpstream, type ResultatRoute } from "@/lib/chat/appelRouteUpstream"

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
      AND: [{ nom: { equals: nomRecherche, mode: "insensitive" } }, visibiliteReferentiel(userId)],
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
      AND: [{ nom: { contains: nomRecherche, mode: "insensitive" } }, visibiliteReferentiel(userId)],
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


/**
 * Résout une planche par son nom pour les outils d'écriture. Le tenant courant
 * est la seule portée : la planche d'un autre compte est introuvable, jamais
 * nommée. Exacte d'abord (insensible à la casse), puis partielle ; une
 * ambiguïté est une erreur listant les candidats.
 */
async function resoudrePlancheParNom(
  nom: string,
  userId: string
): Promise<{ plancheId?: string; erreur?: string }> {
  const nomRecherche = nom.trim()
  if (nomRecherche === "") return { erreur: "Le nom de la planche est vide." }

  const exactes = await prisma.planche.findMany({
    where: { userId, nom: { equals: nomRecherche, mode: "insensitive" } },
    select: { id: true, nom: true },
    take: 5,
  })
  if (exactes.length === 1) return { plancheId: exactes[0].id }
  if (exactes.length > 1) {
    return {
      erreur: `Plusieurs planches s'appellent "${nomRecherche}" : ${exactes.map((p) => `${p.nom} (id ${p.id})`).join(", ")}. Précisez avec plancheId.`,
    }
  }

  const partielles = await prisma.planche.findMany({
    where: { userId, nom: { contains: nomRecherche, mode: "insensitive" } },
    select: { id: true, nom: true },
    take: 6,
  })
  if (partielles.length === 1) return { plancheId: partielles[0].id }
  if (partielles.length > 1) {
    return {
      erreur: `Plusieurs planches correspondent à "${nomRecherche}" : ${partielles.map((p) => p.nom).join(", ")}. Précisez le nom exact.`,
    }
  }
  return { erreur: `Aucune planche trouvée pour "${nomRecherche}" : la culture n'a pas été créée.` }
}

/**
 * Résout une variété par son nom DANS l'espèce donnée, avec la visibilité du
 * référentiel (officielle, communautaire, ou perso du tenant). Exacte d'abord,
 * puis partielle ; ambiguïté = erreur listant les candidats.
 */
async function resoudreVarieteParNom(
  nom: string,
  especeId: string,
  userId: string
): Promise<{ varieteId?: string; erreur?: string }> {
  const nomRecherche = nom.trim()
  if (nomRecherche === "") return { erreur: "Le nom de la variété est vide." }

  const exactes = await prisma.variete.findMany({
    where: {
      AND: [{ especeId, nom: { equals: nomRecherche, mode: "insensitive" } }, visibiliteReferentiel(userId)],
    },
    select: { id: true, nom: true, userId: true },
    take: 5,
  })
  if (exactes.length === 1) return { varieteId: exactes[0].id }
  if (exactes.length > 1) {
    const perso = exactes.find((v) => v.userId === userId)
    if (perso) return { varieteId: perso.id }
    return { erreur: `Plusieurs variétés correspondent à "${nomRecherche}" pour l'espèce « ${especeId} ». Précisez le nom exact.` }
  }

  const partielles = await prisma.variete.findMany({
    where: {
      AND: [{ especeId, nom: { contains: nomRecherche, mode: "insensitive" } }, visibiliteReferentiel(userId)],
    },
    select: { id: true, nom: true, userId: true },
    take: 6,
  })
  if (partielles.length === 1) return { varieteId: partielles[0].id }
  if (partielles.length > 1) {
    return {
      erreur: `Plusieurs variétés correspondent à "${nomRecherche}" : ${partielles.map((v) => v.nom ?? v.id).join(", ")}. Précisez le nom.`,
    }
  }
  return { erreur: `Aucune variété trouvée pour "${nomRecherche}" dans l'espèce « ${especeId} » : la culture n'a pas été créée.` }
}


// ============================================================
// ÉCRITURES : appel des routes d'upstream (phase 2c)
// ============================================================

const TYPES_INTERVENTION = [
  "semis", "plantation", "desherbage", "binage", "paillage",
  "traitement_phyto", "fertilisation", "recolte", "taille",
  "arrosage", "tuteurage", "autre",
]

const TYPES_OBJET_JARDIN = ["allee", "passage", "bordure", "serre", "compost", "autre"]

/** Nombre fini, ou message d'erreur lisible (jamais `NaN` transmis à une route). */
function lireNombre(valeur: unknown, champ: string): number | string {
  const nombre = typeof valeur === "string" && valeur.trim() === "" ? Number.NaN : Number(valeur)
  return Number.isFinite(nombre) ? nombre : `${champ} invalide : un nombre est attendu.`
}

/** Référence {id, nom} (et placeholder pour une variété) lue dans la réponse d'une route ; null si absente. */
function lireRef(
  valeur: unknown,
  avecPlaceholder = false
): { id: string; nom: string | null; placeholder?: boolean } | null {
  if (typeof valeur !== "object" || valeur === null) return null
  const v = valeur as { id?: unknown; nom?: unknown; isPlaceholder?: unknown }
  if (typeof v.id !== "string") return null
  const ref: { id: string; nom: string | null; placeholder?: boolean } = {
    id: v.id,
    nom: typeof v.nom === "string" ? v.nom : null,
  }
  if (avecPlaceholder) ref.placeholder = v.isPlaceholder === true
  return ref
}

/**
 * Refus d'upstream propagé au modèle : message tel quel, en français. Un 409
 * « avertissement » (rotation) est signalé mais jamais forcé : la confirmation
 * explicite de l'utilisateur viendra en phase 5.
 */
function refusOutil(res: Extract<ResultatRoute, { ok: false }>): { erreur: string; avertissement?: true } {
  return res.avertissement ? { erreur: res.message, avertissement: true } : { erreur: res.message }
}

/**
 * Les routes d'upstream appliquent le rôle de la session : un administrateur
 * qui crée ou supprime une variété agit sur le catalogue OFFICIEL (userId nul),
 * pas sur une variété perso. Les outils « _perso » ne doivent jamais le faire
 * par la voix de l'assistant : refus explicite, l'écran dédié reste disponible.
 */
async function refuserSiAdminReferentiel(): Promise<{ erreur: string } | null> {
  const { getSession } = await import("@/lib/auth-utils")
  const session = await getSession()
  if (session?.user?.role === "ADMIN") {
    return {
      erreur:
        "Un compte administrateur agit sur le catalogue officiel : les variétés se gèrent depuis l'écran Variétés, pas par l'assistant.",
    }
  }
  return null
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
        
        const annee = Number(args.annee)
        if (args.annee && Number.isInteger(annee)) {
          where.annee = annee
        }

        if (args.espece) {
          where.especeId = String(args.espece)
        }

        // Même règle que GET /api/cultures : le filtre est le miroir exact de
        // la cascade d'affichage (lib/cultures/etat). Un état inconnu est
        // refusé, il ne doit pas être pris pour « toutes les cultures ».
        if (args.etat) {
          const etat = String(args.etat)
          if (!estEtatCulture(etat)) {
            return { erreur: `État inconnu : "${etat}". Valeurs possibles : ${ETATS_CULTURE.join(", ")}.` }
          }
          where.AND = [whereEtatCulture(etat)]
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
          etat: etatCulture(culture),
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
          // Mêmes bornes civiles que les routes d'upstream (fin de journée du
          // 31/12 incluse) ; une année invalide retombe sur l'année courante.
          const { bornes } = lireAnnee(new URLSearchParams({ annee: String(args.annee) }))
          if (bornes) where.date = bornes
        }
        
        if (args.espece) {
          where.especeId = String(args.espece)
        }

        const limitDemande = Number(args.limit)
        const limit = Number.isFinite(limitDemande) && limitDemande >= 1 ? Math.min(Math.floor(limitDemande), 100) : 30

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
          // Quantité dans l'unité figée à la saisie (kg, tige, piece, botte).
          quantite: recolte.quantite,
          unite: recolte.unite ?? "kg",
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
    handler: async (args: Record<string, unknown>, userId: string) => {
      try {
        const filtres: Prisma.EspeceWhereInput = {}

        if (args.search) {
          filtres.nom = { contains: String(args.search), mode: "insensitive" }
        }

        if (args.type) {
          filtres.type = String(args.type)
        }

        // Référentiel commun, partagé à la communauté, ou propre au compte :
        // jamais l'espèce privée d'un autre compte (même règle que /api/especes).
        const where: Prisma.EspeceWhereInput = { AND: [filtres, visibiliteReferentiel(userId)] }

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
    description:
      "Récupère les itinéraires techniques (ITP) utilisables par l'utilisateur : référentiel officiel, ITP partagés par la communauté et ITP personnels, adaptés à sa zone climatique",
    parameters: {},
    handler: async (args: Record<string, unknown>, userId: string) => {
      try {
        // Mêmes règles d'accès que GET /api/itps?applicable=1&calibre=1 :
        // visible, actif, applicable à la zone, semaines calées sur la zone.
        const userZone = await zoneEffectiveUser(prisma, userId)
        const itps = await prisma.iTP.findMany({
          where: { AND: [whereItpUtilisable(userId), whereItpApplicable(userZone)] },
          include: {
            espece: { select: { nom: true } },
          },
          orderBy: [{ semaineSemis: "asc" }, { id: "asc" }],
          take: 200,
        })

        return masquerReferentielsEmbarques(itps, userId).map((itp) => {
          const calage = appliquerDecalageItp(itp, decalageItpPourLecteur(itp, userZone, userId))
          return {
            id: itp.id,
            espece: itp.espece?.nom,
            semaineSemis: calage.semaineSemis,
            semainePlantation: calage.semainePlantation,
            semaineRecolte: calage.semaineRecolte,
            dureeCulture: itp.dureeCulture,
          }
        })
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
        // Source de vérité du tableau de bord (lib/kpi), pas un recalcul local.
        const asOf = new Date()
        const kpi = await getKpiMaraichage(userId, asOf.getFullYear(), asOf)

        return {
          annee: kpi.year,
          culturesActives: kpi.culturesActives,
          culturesPlanifiees: kpi.culturesPlanifiees,
          culturesTerminees: kpi.culturesTerminees,
          surfaceCultiveeM2: kpi.surfaceCultiveeM2,
          surfacePlanifieeM2: kpi.surfacePlanifieeM2,
          planchesCount: kpi.planchesCount,
          recoltesKgYtd: kpi.recoltesKgYtd,
          recoltesParUniteYtd: kpi.recoltesParUniteYtd,
        }
      } catch {
        return { erreur: "Impossible de récupérer les statistiques" }
      }
    },
  },
  {
    name: "create_intervention",
    description:
      "Crée une tâche / intervention dans le jardin (semis, plantation, désherbage, arrosage, récolte, taille, etc.). Utilise cet outil quand l'utilisateur demande de créer, planifier ou enregistrer une tâche ou une action à faire. L'outil ne rattache l'intervention à AUCUNE planche ni culture : n'affirme jamais à l'utilisateur un tel rattachement, mentionne la planche seulement dans la description libre.",
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
    handler: async (args: Record<string, unknown>) => {
      const type = String(args.type ?? "")
      if (!TYPES_INTERVENTION.includes(type)) {
        return { erreur: `Type d'intervention invalide : "${type}". Types acceptés : ${TYPES_INTERVENTION.join(", ")}.` }
      }
      const corps: Record<string, unknown> = {
        type,
        fait: args.fait === undefined ? true : Boolean(args.fait),
        // Jour civil local : `date` est obligatoire côté route.
        date: args.date ? String(args.date) : jourLocalISO(new Date()),
      }
      if (args.description) corps.description = String(args.description)
      if (args.datePrevue) corps.datePrevue = String(args.datePrevue)
      if (args.dureeMinutes !== undefined) {
        const duree = lireNombre(args.dureeMinutes, "dureeMinutes")
        if (typeof duree === "string") return { erreur: duree }
        corps.dureeMinutes = duree
      }

      const { POST } = await import("@/app/api/interventions/route")
      const res = await appelerRouteUpstream(POST, { methode: "POST", chemin: "/api/interventions", corps })
      if (!res.ok) return refusOutil(res)
      const d = res.donnees
      return {
        succes: true,
        message: `Intervention "${type}" créée (id ${d.id}).`,
        intervention: { id: d.id, type: d.type, description: d.description, date: d.date, fait: d.fait },
      }
    },
  },
  {
    name: "create_culture",
    description:
      "Crée une nouvelle culture (un semis ou une plantation planifié) pour une espèce donnée. Utilise cet outil quand l'utilisateur veut ajouter une culture, semer ou planter une espèce. L'espèce peut être donnée par son nom (ex: 'tomate') ou par son id. Renseigne TOUJOURS la planche (plancheNom ou plancheId) quand l'utilisateur la mentionne, ainsi que la variété (varieteNom ou varieteId), l'ITP (itpId) et les notes s'il en donne : sans planche, aucun contrôle de rotation ni d'occupation n'a lieu. Une planche ou une variété introuvable fait échouer la création. semisFait et plantationFaite restent false pour un projet ou une date « aujourd'hui ». N'affirme JAMAIS à l'utilisateur un rattachement (planche, variété, ITP) que le résultat de l'outil ne confirme pas : le résultat indique ce qui est réellement enregistré.",
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
        plancheNom: {
          type: "string",
          description: "Nom de la planche de l'utilisateur (ex: 'A1'). Utilisé si plancheId n'est pas fourni. Introuvable ou ambigu : erreur, aucune création.",
        },
        plancheId: {
          type: "string",
          description: "ID de la planche (si déjà connu). Prioritaire sur plancheNom.",
        },
        varieteNom: {
          type: "string",
          description: "Nom de la variété, dans l'espèce choisie (ex: 'Marmande'). Utilisé si varieteId n'est pas fourni.",
        },
        varieteId: {
          type: "string",
          description: "ID de la variété (si déjà connu). Prioritaire sur varieteNom.",
        },
        itpId: {
          type: "string",
          description: "ID de l'itinéraire technique (facultatif), de la même espèce que la culture.",
        },
        notes: {
          type: "string",
          description: "Notes libres de l'utilisateur sur la culture (5000 caractères au plus).",
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
          description:
            "true UNIQUEMENT si l'utilisateur dit explicitement que le semis est déjà FAIT (« j'ai semé », « déjà semé »). false pour un projet, une planification ou une date « aujourd'hui ». Défaut : false.",
        },
        plantationFaite: {
          type: "boolean",
          description:
            "true UNIQUEMENT si l'utilisateur dit explicitement que la plantation est déjà FAITE (« j'ai planté », « déjà plantée »). false pour un projet, une planification ou une date « aujourd'hui ». Défaut : false.",
        },
      },
    },
    handler: async (args: Record<string, unknown>, userId: string) => {
      // Résolution de l'espèce (nom -> id) ; la route vérifie ensuite sa visibilité.
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

      // Planche : l'id prime ; un nom est résolu sur le tenant. Demandée mais
      // introuvable : erreur, jamais une création silencieuse sans elle.
      let plancheId = args.plancheId ? String(args.plancheId) : ""
      if (plancheId === "" && args.plancheNom) {
        const resolution = await resoudrePlancheParNom(String(args.plancheNom), userId)
        if (resolution.erreur) return { erreur: resolution.erreur }
        plancheId = resolution.plancheId!
      }
      let varieteId = args.varieteId ? String(args.varieteId) : ""
      if (varieteId === "" && args.varieteNom) {
        const resolution = await resoudreVarieteParNom(String(args.varieteNom), especeId, userId)
        if (resolution.erreur) return { erreur: resolution.erreur }
        varieteId = resolution.varieteId!
      }

      const annee = args.annee !== undefined ? lireNombre(args.annee, "annee") : new Date().getFullYear()
      if (typeof annee === "string") return { erreur: annee }
      const corps: Record<string, unknown> = {
        especeId,
        annee,
        ...(plancheId ? { plancheId } : {}),
        ...(varieteId ? { varieteId } : {}),
        ...(args.itpId ? { itpId: String(args.itpId) } : {}),
        ...(typeof args.notes === "string" && args.notes.trim() !== "" ? { notes: args.notes } : {}),
        semisFait: args.semisFait === true,
        plantationFaite: args.plantationFaite === true,
        recolteFaite: false,
      }
      for (const champ of ["dateSemis", "datePlantation", "dateRecolte"] as const) {
        if (args[champ]) corps[champ] = String(args[champ])
      }
      if (args.quantite !== undefined) {
        const quantite = lireNombre(args.quantite, "quantite")
        if (typeof quantite === "string") return { erreur: quantite }
        corps.quantite = quantite
      }

      // Pas de `confirmRotation` : un avertissement de rotation n'est jamais forcé ici.
      const { POST } = await import("@/app/api/cultures/route")
      const res = await appelerRouteUpstream(POST, { methode: "POST", chemin: "/api/cultures", corps })
      if (!res.ok) return refusOutil(res)
      const d = res.donnees
      const nomEspece = (d.espece as { nom?: string } | null | undefined)?.nom ?? especeId
      // Ce qui est RÉELLEMENT enregistré, relu de la réponse de la route.
      const plancheEnregistree = lireRef(d.planche)
      const varieteEnregistree = lireRef(d.variete, true)
      const itpEnregistre = lireRef(d.itp)
      const notesEnregistrees = typeof d.notes === "string" && d.notes !== "" ? d.notes : null
      const messagePlanche = plancheEnregistree
        ? `sur la planche « ${plancheEnregistree.nom ?? plancheEnregistree.id} »`
        : "aucune planche rattachée"
      return {
        succes: true,
        message: `Culture "${nomEspece}" créée (id ${d.id}), ${messagePlanche}.`,
        ...(plancheEnregistree
          ? {}
          : { aucunePlanche: "Aucune planche rattachée : ni rotation, ni occupation, ni verdict ITP n'ont été contrôlés." }),
        culture: {
          id: d.id,
          espece: nomEspece,
          planche: plancheEnregistree,
          variete: varieteEnregistree,
          itp: itpEnregistre,
          notes: notesEnregistrees,
          annee: d.annee,
          dateSemis: d.dateSemis,
          datePlantation: d.datePlantation,
          semisFait: d.semisFait,
          plantationFaite: d.plantationFaite,
        },
        ...(Array.isArray(d.warnings) ? { avertissements: d.warnings } : {}),
        ...(d.alerteSaison ? { alerteSaison: d.alerteSaison } : {}),
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
    handler: async (args: Record<string, unknown>) => {
      const cultureId = Number(args.cultureId)
      if (!Number.isInteger(cultureId) || cultureId <= 0) {
        return { erreur: "cultureId invalide." }
      }

      // Étapes et dates : PATCH rapide (garde des récoltes, cohérence du cycle).
      // Quantité : PUT, que PATCH n'accepte pas.
      const patch: Record<string, unknown> = {}
      for (const champ of ["semisFait", "plantationFaite", "recolteFaite"] as const) {
        if (args[champ] !== undefined) patch[champ] = Boolean(args[champ])
      }
      for (const champ of ["dateSemis", "datePlantation", "dateRecolte"] as const) {
        if (args[champ]) patch[champ] = String(args[champ])
      }
      let quantite: number | undefined
      if (args.quantite !== undefined) {
        const lue = lireNombre(args.quantite, "quantite")
        if (typeof lue === "string") return { erreur: lue }
        quantite = lue
      }
      if (Object.keys(patch).length === 0 && quantite === undefined) {
        return { erreur: "Aucun champ à mettre à jour." }
      }

      const params = { id: String(cultureId) }
      const chemin = `/api/cultures/${cultureId}`
      const { PATCH, PUT } = await import("@/app/api/cultures/[id]/route")
      let derniere: Record<string, unknown> = {}
      let patchAppliquee = false
      if (Object.keys(patch).length > 0) {
        const res = await appelerRouteUpstream(PATCH, { methode: "PATCH", chemin, corps: patch, params })
        if (!res.ok) return refusOutil(res)
        derniere = res.donnees
        patchAppliquee = true
      }
      if (quantite !== undefined) {
        const res = await appelerRouteUpstream(PUT, { methode: "PUT", chemin, corps: { quantite }, params })
        if (!res.ok) {
          const refus = refusOutil(res)
          return patchAppliquee
            ? { ...refus, erreur: `Les étapes et dates ont été enregistrées, mais pas la quantité : ${res.message}` }
            : refus
        }
        derniere = { ...derniere, ...res.donnees }
      }

      const c = derniere
      const nomEspece = (c.espece as { nom?: string } | null | undefined)?.nom
      return {
        succes: true,
        message: `Culture${nomEspece ? ` "${nomEspece}"` : ""} (id ${cultureId}) mise à jour.`,
        culture: {
          id: cultureId,
          espece: nomEspece,
          semisFait: c.semisFait,
          plantationFaite: c.plantationFaite,
          recolteFaite: c.recolteFaite,
          dateSemis: c.dateSemis,
          datePlantation: c.datePlantation,
          dateRecolte: c.dateRecolte,
          quantite: c.quantite,
        },
        ...(Array.isArray(c.warnings) ? { avertissements: c.warnings } : {}),
      }
    },
  },
  {
    name: "create_planche",
    description: "Crée une nouvelle planche de culture. Refusée si une planche du même nom existe déjà.",
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
    handler: async (args: Record<string, unknown>) => {
      const corps: Record<string, unknown> = { nom: String(args.nom ?? "") }
      for (const champ of ["largeur", "longueur", "surface", "posX", "posY"] as const) {
        if (args[champ] !== undefined) {
          const lue = lireNombre(args[champ], champ)
          if (typeof lue === "string") return { erreur: lue }
          corps[champ] = lue
        }
      }
      for (const champ of ["type", "irrigation", "ilot", "parcelleGeoId", "notes"] as const) {
        if (args[champ]) corps[champ] = String(args[champ])
      }

      // Validation, doublon (409), surface arrondie et cache KPI : route d'upstream.
      const { POST } = await import("@/app/api/planches/route")
      const res = await appelerRouteUpstream(POST, { methode: "POST", chemin: "/api/planches", corps })
      if (!res.ok) return refusOutil(res)
      const d = res.donnees
      return { succes: true, planche: { id: d.id, nom: d.nom, surface: d.surface, type: d.type, ilot: d.ilot } }
    },
  },
  {
    name: "delete_planche",
    description: "Supprime définitivement une planche de culture par son nom. Refusée si une culture ou une intervention est liée à la planche.",
    parameters: {
      type: "object",
      properties: {
        nom: { type: "string", description: "Nom de la planche à supprimer (obligatoire)" },
      },
      required: ["nom"],
    },
    handler: async (args: Record<string, unknown>) => {
      const nom = String(args.nom ?? "").trim()
      if (nom === "") return { erreur: "Le nom de la planche est requis." }

      // La route résout un identifiant ou un nom, et refuse si une culture OU une intervention la retient.
      const { DELETE } = await import("@/app/api/planches/[id]/route")
      const res = await appelerRouteUpstream(DELETE, {
        methode: "DELETE",
        chemin: `/api/planches/${encodeURIComponent(nom)}`,
        params: { id: encodeURIComponent(nom) },
      })
      if (!res.ok) return refusOutil(res)
      return { succes: true, supprimee: typeof res.donnees.deleted === "string" ? res.donnees.deleted : nom }
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
    handler: async (args: Record<string, unknown>) => {
      const type = String(args.type)
      if (!TYPES_OBJET_JARDIN.includes(type)) {
        return { erreur: `Type d'objet invalide : "${type}". Types acceptés : ${TYPES_OBJET_JARDIN.join(", ")}.` }
      }
      const nombres: Record<string, number> = {}
      for (const champ of ["largeur", "longueur", "posX", "posY"] as const) {
        const lue = lireNombre(args[champ], champ)
        if (typeof lue === "string") return { erreur: lue }
        nombres[champ] = lue
      }
      if (nombres.largeur <= 0 || nombres.longueur <= 0) {
        return { erreur: "Largeur et longueur doivent être positives." }
      }
      const corps: Record<string, unknown> = { type, ...nombres }
      for (const champ of ["nom", "parcelleGeoId", "couleur", "notes"] as const) {
        if (args[champ]) corps[champ] = String(args[champ])
      }

      const { POST } = await import("@/app/api/objets-jardin/route")
      const res = await appelerRouteUpstream(POST, { methode: "POST", chemin: "/api/objets-jardin", corps })
      if (!res.ok) return refusOutil(res)
      const d = res.donnees
      return { succes: true, objet: { id: d.id, nom: d.nom, type: d.type, largeur: d.largeur, longueur: d.longueur } }
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
    handler: async (args: Record<string, unknown>) => {
      const objetId = Number(args.objetId)
      if (!Number.isInteger(objetId) || objetId <= 0) {
        return { erreur: "objetId invalide." }
      }
      const { DELETE } = await import("@/app/api/objets-jardin/[id]/route")
      const res = await appelerRouteUpstream(DELETE, {
        methode: "DELETE",
        chemin: `/api/objets-jardin/${objetId}`,
        params: { id: String(objetId) },
      })
      if (!res.ok) return refusOutil(res)
      return { succes: true }
    },
  },
  {
    name: "create_variete_perso",
    description: "Crée une nouvelle variété personnelle pour une espèce donnée. Refusée si une variété du même nom existe déjà pour cette espèce.",
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
      const refusAdmin = await refuserSiAdminReferentiel()
      if (refusAdmin) return refusAdmin
      const nom = String(args.nom ?? "").trim()
      if (nom === "") return { erreur: "Le nom de la variété est requis." }
      const resolution = await resoudreEspeceParNom(String(args.especeNom ?? ""), userId)
      if (resolution.erreur) return { erreur: resolution.erreur }

      // `id` porte le NOM saisi (contrat de la route), conservé tel quel.
      const corps: Record<string, unknown> = { id: nom, especeId: resolution.especeId!, bio: args.bio === true }
      if (args.description) corps.description = String(args.description)
      for (const champ of ["semaineRecolte", "dureeRecolte"] as const) {
        if (args[champ] !== undefined) {
          const lue = lireNombre(args[champ], champ)
          if (typeof lue === "string") return { erreur: lue }
          corps[champ] = lue
        }
      }

      const { POST } = await import("@/app/api/varietes/route")
      const res = await appelerRouteUpstream(POST, { methode: "POST", chemin: "/api/varietes", corps })
      if (!res.ok) return refusOutil(res)
      const d = res.donnees
      return { succes: true, variete: { id: d.id, nom: d.nom, especeId: d.especeId } }
    },
  },
  {
    name: "delete_variete_perso",
    description: "Supprime définitivement une variété personnelle par son ID. Refusée si des cultures l'utilisent ou si elle n'appartient pas à l'utilisateur.",
    parameters: {
      type: "object",
      properties: {
        varieteId: { type: "string", description: "ID de la variété à supprimer (obligatoire)" },
      },
      required: ["varieteId"],
    },
    handler: async (args: Record<string, unknown>) => {
      const refusAdmin = await refuserSiAdminReferentiel()
      if (refusAdmin) return refusAdmin
      const varieteId = String(args.varieteId ?? "").trim()
      if (varieteId === "") return { erreur: "L'identifiant de la variété est requis." }

      // La route refuse (409) si des cultures utilisent la variété, et (403) si elle n'est pas à l'utilisateur.
      const { DELETE } = await import("@/app/api/varietes/[id]/route")
      const res = await appelerRouteUpstream(DELETE, {
        methode: "DELETE",
        chemin: "/api/varietes/suppression",
        params: { id: varieteId },
      })
      if (!res.ok) return refusOutil(res)
      return { succes: true }
    },
  },
  {
    name: "delete_culture",
    description: "Supprime définitivement une culture par son ID. Refusée si une récolte de la culture est vendue ou facturée, ou si ses lots sont liés à des bons ou factures.",
    parameters: {
      type: "object",
      properties: {
        cultureId: { type: "number", description: "ID de la culture à supprimer (obligatoire)" },
      },
      required: ["cultureId"],
    },
    handler: async (args: Record<string, unknown>) => {
      const cultureId = Number(args.cultureId)
      if (!Number.isInteger(cultureId) || cultureId <= 0) {
        return { erreur: "cultureId invalide." }
      }
      // La route refuse (409) une culture dont une récolte est vendue ou facturée, ou dont les lots sont liés à des bons.
      const { DELETE } = await import("@/app/api/cultures/[id]/route")
      const res = await appelerRouteUpstream(DELETE, {
        methode: "DELETE",
        chemin: `/api/cultures/${cultureId}`,
        params: { id: String(cultureId) },
      })
      if (!res.ok) return refusOutil(res)
      return { succes: true, supprimee: cultureId }
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

// ============================================================
// DROITS D'ÉCRITURE (chat)
// ============================================================

/**
 * Upstream exclut /api/chat du refus de mutation par méthode et refuse les
 * outils d'écriture « à l'exécution ». Ce contexte porte le droit d'écrire de
 * la session pendant toute la requête de chat, sans changer la signature des
 * outils ni des boucles de providers. Sans contexte (appel direct, tests),
 * aucun refus : le chemin MCP, lui, n'exécute que des lectures.
 */
const droitsChat = new AsyncLocalStorage<{ peutEcrire: boolean }>()

export function executerAvecDroitsChat<T>(droits: { peutEcrire: boolean }, fn: () => Promise<T>): Promise<T> {
  return droitsChat.run(droits, fn)
}

/** Les outils de lecture sont préfixés `get_` ; tout le reste écrit. */
function estOutilEcriture(name: string): boolean {
  return !name.startsWith("get_")
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

    if (outil && estOutilEcriture(name) && droitsChat.getStore()?.peutEcrire === false) {
      return JSON.stringify({
        erreur: "Votre rôle dans cette exploitation est en lecture seule : cette modification est refusée.",
      })
    }
    
    if (!outil) {
      return JSON.stringify({ erreur: `Outil inconnu : ${name}` })
    }
    
    const resultat = await outil.handler(args, userId)
    return JSON.stringify(resultat)
  } catch (caughtError) {
    if (caughtError instanceof SyntaxError) {
      return JSON.stringify({ erreur: "Arguments de l'outil invalides (JSON illisible)." })
    }
    // Détail au journal serveur seulement : le modèle ne reçoit jamais un message technique brut.
    console.error(`executerOutil(${name}) :`, caughtError)
    return JSON.stringify({ erreur: "L'outil a échoué : l'opération n'a pas pu aboutir." })
  }
}