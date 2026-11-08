/**
 * Outils d'écriture de l'assistant (phase 2c, approche A).
 *
 * Chaque outil appelle EN PROCESSUS le handler de la route d'upstream : ce sont
 * les vrais handlers qui tournent ici (validation, rotation, ventes, traces de
 * planche, etc.). Seuls l'authentification, Prisma, le cache KPI et les
 * dépendances de bas niveau sont simulés, comme dans les tests de routes
 * d'upstream (`cultures/route.test.ts`, `cultures/[id]/route.delete.test.ts`).
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuthApi: vi.fn(),
  getSession: vi.fn(),
  headers: vi.fn(),
  invalidateKpi: vi.fn(),
  invalidateIrrigation: vi.fn(),
  checkRotation: vi.fn(),
  // espèces / variétés
  especeFindMany: vi.fn(),
  especeFindFirst: vi.fn(),
  varieteFindFirst: vi.fn(),
  varieteCreate: vi.fn(),
  varieteDelete: vi.fn(),
  // cultures
  cultureCreate: vi.fn(),
  cultureFindUnique: vi.fn(),
  cultureUpdate: vi.fn(),
  cultureDelete: vi.fn(),
  cultureGroupBy: vi.fn(),
  recolteFindMany: vi.fn(),
  venteFindMany: vi.fn(),
  venteDeleteMany: vi.fn(),
  stockCommercialCount: vi.fn(),
  // planches
  plancheFindFirst: vi.fn(),
  plancheFindUnique: vi.fn(),
  plancheCreate: vi.fn(),
  plancheDelete: vi.fn(),
  // interventions
  interventionCreate: vi.fn(),
  interventionGroupBy: vi.fn(),
  // objets du jardin
  objetCreate: vi.fn(),
  objetFindUnique: vi.fn(),
  objetDelete: vi.fn(),
}))

vi.mock("next/headers", () => ({ headers: mocks.headers }))
vi.mock("@/lib/auth-utils", () => ({
  requireAuthApi: mocks.requireAuthApi,
  getSession: mocks.getSession,
}))
vi.mock("@/lib/kpi", () => ({ invalidateKpi: mocks.invalidateKpi, getKpiMaraichage: vi.fn() }))
vi.mock("@/lib/irrigation-cache", () => ({ irrigationCache: { invalidateUser: mocks.invalidateIrrigation } }))
vi.mock("@/lib/rotation-check", () => ({ checkRotationViolation: mocks.checkRotation }))
vi.mock("@/lib/varietes", () => ({ ensurePlaceholderVariete: vi.fn().mockResolvedValue("variete-placeholder") }))
vi.mock("@/lib/auto-compta", () => ({ createDepenseFromIntervention: vi.fn(), deleteAutoEntry: vi.fn() }))
vi.mock("@/lib/irrigation-recording", () => ({ supprimerArrosageNote: vi.fn() }))
vi.mock("@/lib/cache-helper", () => ({ getOrFetch: vi.fn() }))
vi.mock("@/lib/meteo", () => ({ fetchOpenMeteoForecast: vi.fn(), fetchOpenMeteoHistory: vi.fn() }))
vi.mock("@/lib/terroir", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/terroir")>()),
  zoneEffectiveUser: vi.fn().mockResolvedValue(null),
}))
vi.mock("@/lib/prisma", () => {
  const tx = {
    $executeRaw: vi.fn(),
    culture: { create: mocks.cultureCreate, delete: mocks.cultureDelete },
    intervention: { create: mocks.interventionCreate },
    venteManuelle: { deleteMany: mocks.venteDeleteMany },
    variete: { create: mocks.varieteCreate },
    userStockVariete: { findUnique: vi.fn().mockResolvedValue(null) },
  }
  return {
    default: {
      espece: { findMany: mocks.especeFindMany, findFirst: mocks.especeFindFirst },
      variete: { findFirst: mocks.varieteFindFirst, delete: mocks.varieteDelete },
      culture: {
        findUnique: mocks.cultureFindUnique,
        update: mocks.cultureUpdate,
        groupBy: mocks.cultureGroupBy,
      },
      recolte: { findMany: mocks.recolteFindMany },
      venteManuelle: { findMany: mocks.venteFindMany },
      mouvementStockCommercial: { count: mocks.stockCommercialCount },
      planche: {
        findFirst: mocks.plancheFindFirst,
        findUnique: mocks.plancheFindUnique,
        create: mocks.plancheCreate,
        delete: mocks.plancheDelete,
      },
      intervention: { groupBy: mocks.interventionGroupBy },
      objetJardin: { create: mocks.objetCreate, findUnique: mocks.objetFindUnique, delete: mocks.objetDelete },
      $transaction: (fn: (t: unknown) => unknown) => fn(tx),
    },
  }
})

import { executerAvecDroitsChat, executerOutil, outilsChat } from "../chat-tools"

const tenant = "u1"
const session = { user: { id: tenant, role: "USER", peutEcrireExploitation: true } }

const lancer = async (nom: string, args: Record<string, unknown>) =>
  JSON.parse(await executerAvecDroitsChat({ peutEcrire: true }, () => executerOutil(nom, JSON.stringify(args), tenant)))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.headers.mockResolvedValue(new Headers({ cookie: "authjs.session-token=abc", "x-gleba-mutation": "0" }))
  mocks.requireAuthApi.mockResolvedValue({ error: null, session })
  mocks.getSession.mockResolvedValue(session)
  mocks.checkRotation.mockResolvedValue(null)
  mocks.stockCommercialCount.mockResolvedValue(0)
  mocks.venteFindMany.mockResolvedValue([])
  mocks.recolteFindMany.mockResolvedValue([])
  mocks.cultureGroupBy.mockResolvedValue([])
  mocks.interventionGroupBy.mockResolvedValue([])
  mocks.especeFindMany.mockResolvedValue([{ id: "Tomate", nom: "Tomate", userId: null }])
  mocks.especeFindFirst.mockResolvedValue({ id: "Tomate", nom: "Tomate", besoinEau: 1, irrigation: null })
})

describe("create_intervention (POST /api/interventions)", () => {
  it("nominal : crée l'intervention, invalide le cache KPI ET le cache d'irrigation", async () => {
    mocks.interventionCreate.mockImplementation(async ({ data }) => ({ id: 5, ...data }))
    const res = await lancer("create_intervention", { type: "arrosage", description: "Tomates", date: "2026-11-01" })
    expect(res).toMatchObject({ succes: true, intervention: { id: 5, type: "arrosage" } })
    expect(mocks.interventionCreate.mock.calls[0][0].data.userId).toBe(tenant)
    expect(mocks.invalidateKpi).toHaveBeenCalledWith(tenant)
    expect(mocks.invalidateIrrigation).toHaveBeenCalledWith(tenant)
  })

  it("refus d'upstream : une intervention réalisée datée dans le futur est refusée (400), rien n'est écrit", async () => {
    const res = await lancer("create_intervention", { type: "arrosage", date: "2099-01-01", fait: true })
    expect(res.erreur).toMatch(/se date au plus tard aujourd'hui/)
    expect(mocks.interventionCreate).not.toHaveBeenCalled()
  })

  it("type invalide : refus sans appel de route", async () => {
    const res = await lancer("create_intervention", { type: "bidon" })
    expect(res.erreur).toMatch(/Type d'intervention invalide/)
    expect(mocks.requireAuthApi).not.toHaveBeenCalled()
  })
})

describe("create_culture (POST /api/cultures)", () => {
  const cultureCreee = { id: 1, annee: 2026, semisFait: false, plantationFaite: false, espece: { nom: "Tomate" } }

  it("nominal : résout le nom en id, crée via la route, variété placeholder, cache KPI", async () => {
    mocks.cultureCreate.mockResolvedValue(cultureCreee)
    const res = await lancer("create_culture", { especeNom: "Tomate", annee: 2026, dateSemis: "2026-11-01" })
    expect(res).toMatchObject({ succes: true, culture: { id: 1, espece: "Tomate" } })
    const data = mocks.cultureCreate.mock.calls[0][0].data
    expect(data).toMatchObject({ especeId: "Tomate", userId: tenant, varieteId: "variete-placeholder", rotationViolee: false })
    expect(data.dateSemis).toBeInstanceOf(Date) // jour civil, pas une chaîne brute
    expect(mocks.invalidateKpi).toHaveBeenCalledWith(tenant)
  })

  it("refus d'upstream : une espèce privée d'un autre compte (id fourni) est refusée en 400", async () => {
    mocks.especeFindFirst.mockResolvedValue(null)
    const res = await lancer("create_culture", { especeId: "espece-privee-autrui" })
    expect(res.erreur).toMatch(/n'est pas disponible : introuvable ou privée/)
    expect(mocks.cultureCreate).not.toHaveBeenCalled()
  })

  it("refus d'upstream : récolte antérieure au semis refusée (400)", async () => {
    const res = await lancer("create_culture", {
      especeNom: "Tomate",
      annee: 2026,
      dateSemis: "2026-06-10",
      dateRecolte: "2026-05-01",
    })
    expect(res.erreur).toBeTruthy()
    expect(mocks.cultureCreate).not.toHaveBeenCalled()
  })

  it("rotation violée : le 409 « Continuer ? » est renvoyé tel quel et JAMAIS forcé (pas de confirmRotation)", async () => {
    mocks.checkRotation.mockResolvedValue({ message: "Rotation non respectée : Tomate après Tomate.", violations: [] })
    const res = await lancer("create_culture", { especeNom: "Tomate", annee: 2026 })
    expect(res).toEqual({ erreur: "Rotation non respectée : Tomate après Tomate.", avertissement: true })
    expect(mocks.cultureCreate).not.toHaveBeenCalled()
    expect(mocks.checkRotation).toHaveBeenCalledTimes(1) // aucun second appel avec confirmation
  })

  it("validation d'upstream : année absurde refusée (400) avec le détail du champ", async () => {
    const res = await lancer("create_culture", { especeNom: "Tomate", annee: 1900 })
    expect(res.erreur).toMatch(/Données invalides.*annee/)
    expect(mocks.cultureCreate).not.toHaveBeenCalled()
  })

  it("nombre illisible : refus propre, pas de NaN transmis", async () => {
    const res = await lancer("create_culture", { especeNom: "Tomate", quantite: "beaucoup" })
    expect(res.erreur).toMatch(/quantite invalide/)
    expect(mocks.requireAuthApi).not.toHaveBeenCalled()
  })
})

describe("update_culture (PATCH / PUT /api/cultures/[id])", () => {
  const existante = {
    id: 1, userId: tenant, especeId: "Tomate", semisFait: true, plantationFaite: false, recolteFaite: false,
    dateSemis: new Date("2026-03-01T00:00:00Z"), datePlantation: null, dateRecolte: null, finRecolte: null,
    itp: null, _count: { recoltes: 0 },
  }

  it("nominal : marque le semis fait via PATCH, cache KPI invalidé", async () => {
    mocks.cultureFindUnique.mockResolvedValue({ ...existante, semisFait: false })
    mocks.cultureUpdate.mockImplementation(async ({ data }) => ({ ...existante, ...data }))
    const res = await lancer("update_culture", { cultureId: 1, semisFait: true })
    expect(res).toMatchObject({ succes: true, culture: { id: 1, semisFait: true } })
    expect(mocks.invalidateKpi).toHaveBeenCalledWith(tenant)
  })

  it("refus d'upstream : annuler une étape avec des récoltes enregistrées (409), rien n'est écrit", async () => {
    mocks.cultureFindUnique.mockResolvedValue({ ...existante, _count: { recoltes: 3 } })
    const res = await lancer("update_culture", { cultureId: 1, semisFait: false })
    expect(res.erreur).toMatch(/porte 3 récoltes enregistrées/)
    expect(mocks.cultureUpdate).not.toHaveBeenCalled()
  })

  it("refus d'upstream : culture d'un autre compte ou absente (404)", async () => {
    mocks.cultureFindUnique.mockResolvedValue(null)
    const res = await lancer("update_culture", { cultureId: 999, semisFait: true })
    expect(res.erreur).toMatch(/Culture #999 non trouvée/)
  })

  it("aucun champ : refus sans appel de route", async () => {
    const res = await lancer("update_culture", { cultureId: 1 })
    expect(res.erreur).toBe("Aucun champ à mettre à jour.")
    expect(mocks.requireAuthApi).not.toHaveBeenCalled()
  })

  it("cultureId invalide : refus", async () => {
    expect((await lancer("update_culture", { cultureId: 0 })).erreur).toBe("cultureId invalide.")
  })
})

describe("create_planche (POST /api/planches)", () => {
  it("nominal : surface arrondie par upstream, cache KPI", async () => {
    mocks.plancheFindUnique.mockResolvedValue(null)
    mocks.plancheCreate.mockImplementation(async ({ data }) => ({ id: "p1", ...data }))
    const res = await lancer("create_planche", { nom: "A1", largeur: 0.8, longueur: 17 })
    expect(res).toMatchObject({ succes: true, planche: { id: "p1", nom: "A1", surface: 13.6 } })
    expect(mocks.invalidateKpi).toHaveBeenCalledWith(tenant)
  })

  it("refus d'upstream : doublon de nom (409)", async () => {
    mocks.plancheFindUnique.mockResolvedValue({ id: "p0" })
    const res = await lancer("create_planche", { nom: "A1" })
    expect(res.erreur).toBe('La planche "A1" existe déjà')
    expect(mocks.plancheCreate).not.toHaveBeenCalled()
  })

  it("refus d'upstream : largeur hors bornes (400)", async () => {
    const res = await lancer("create_planche", { nom: "A1", largeur: 50 })
    expect(res.erreur).toMatch(/Données invalides.*largeur/)
  })
})

describe("delete_planche (DELETE /api/planches/[id])", () => {
  beforeEach(() => {
    mocks.plancheFindFirst.mockResolvedValue({ id: "p1" })
    mocks.plancheFindUnique.mockResolvedValue({ id: "p1", nom: "A1" })
  })

  it("nominal : planche sans trace supprimée, cache KPI", async () => {
    const res = await lancer("delete_planche", { nom: "A1" })
    expect(res).toEqual({ succes: true, supprimee: "A1" })
    expect(mocks.plancheDelete).toHaveBeenCalledWith({ where: { id: "p1" } })
    expect(mocks.invalidateKpi).toHaveBeenCalledWith(tenant)
  })

  it("refus d'upstream : une INTERVENTION retient la planche (409), rien n'est supprimé", async () => {
    mocks.interventionGroupBy.mockResolvedValue([
      { plancheId: "p1", _count: { _all: 2 }, _min: { date: new Date("2026-05-01") }, _max: { date: new Date("2026-06-01") } },
    ])
    const res = await lancer("delete_planche", { nom: "A1" })
    expect(res.erreur).toMatch(/A1/)
    expect(res.erreur).toMatch(/intervention/i)
    expect(mocks.plancheDelete).not.toHaveBeenCalled()
  })

  it("refus d'upstream : une culture retient la planche (409)", async () => {
    mocks.cultureGroupBy.mockResolvedValue([{ plancheId: "p1", annee: 2026, _count: { _all: 1 } }])
    const res = await lancer("delete_planche", { nom: "A1" })
    expect(res.erreur).toMatch(/culture/i)
    expect(mocks.plancheDelete).not.toHaveBeenCalled()
  })

  it("refus d'upstream : planche inconnue (404)", async () => {
    mocks.plancheFindFirst.mockResolvedValue(null)
    const res = await lancer("delete_planche", { nom: "ZZ" })
    expect(res.erreur).toBe('Planche "ZZ" non trouvée')
  })
})

describe("create_objet_jardin / delete_objet_jardin (/api/objets-jardin)", () => {
  it("création nominale", async () => {
    mocks.objetCreate.mockImplementation(async ({ data }) => ({ id: 3, ...data }))
    const res = await lancer("create_objet_jardin", { type: "allee", largeur: 1, longueur: 5, posX: 0, posY: 0 })
    expect(res).toMatchObject({ succes: true, objet: { id: 3, type: "allee" } })
    expect(mocks.objetCreate.mock.calls[0][0].data.userId).toBe(tenant)
  })

  it("création : dimensions non positives refusées avant la route", async () => {
    const res = await lancer("create_objet_jardin", { type: "allee", largeur: 0, longueur: 5, posX: 0, posY: 0 })
    expect(res.erreur).toMatch(/positives/)
    expect(mocks.objetCreate).not.toHaveBeenCalled()
  })

  it("suppression nominale", async () => {
    mocks.objetFindUnique.mockResolvedValue({ id: 3 })
    expect(await lancer("delete_objet_jardin", { objetId: 3 })).toEqual({ succes: true })
    expect(mocks.objetFindUnique).toHaveBeenCalledWith({ where: { id: 3, userId: tenant } })
  })

  it("refus d'upstream : objet d'un autre compte (404)", async () => {
    mocks.objetFindUnique.mockResolvedValue(null)
    expect((await lancer("delete_objet_jardin", { objetId: 9 })).erreur).toBe("Objet non trouvé")
    expect(mocks.objetDelete).not.toHaveBeenCalled()
  })

  it("identifiant NaN : refus propre", async () => {
    expect((await lancer("delete_objet_jardin", { objetId: "abc" })).erreur).toBe("objetId invalide.")
  })
})

describe("create_variete_perso (POST /api/varietes)", () => {
  beforeEach(() => {
    mocks.varieteFindFirst.mockResolvedValue(null)
    mocks.varieteCreate.mockImplementation(async ({ data }) => ({ id: "cuid1", ...data, espece: { id: data.especeId, userId: null } }))
  })

  it("nominal : libellé conservé tel que saisi (tirets compris), variété perso du tenant", async () => {
    const res = await lancer("create_variete_perso", { nom: "Marc-Phacélie", especeNom: "Tomate" })
    expect(res).toMatchObject({ succes: true, variete: { nom: "Marc-Phacélie", especeId: "Tomate" } })
    expect(mocks.varieteCreate.mock.calls[0][0].data).toMatchObject({ nom: "Marc-Phacélie", userId: tenant })
  })

  it("refus d'upstream : doublon dans le catalogue (409)", async () => {
    mocks.varieteFindFirst.mockResolvedValue({ id: "v0", nom: "Marmande" })
    const res = await lancer("create_variete_perso", { nom: "Marmande", especeNom: "Tomate" })
    expect(res.erreur).toMatch(/Vous avez déjà une variété « Marmande »/)
    expect(mocks.varieteCreate).not.toHaveBeenCalled()
  })

  it("refus d'upstream : semaine de récolte hors bornes (400)", async () => {
    const res = await lancer("create_variete_perso", { nom: "X", especeNom: "Tomate", semaineRecolte: 80 })
    expect(res.erreur).toMatch(/Données invalides.*semaineRecolte/)
  })

  it("un administrateur n'écrit pas dans le catalogue officiel par l'assistant", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: tenant, role: "ADMIN" } })
    const res = await lancer("create_variete_perso", { nom: "X", especeNom: "Tomate" })
    expect(res.erreur).toMatch(/catalogue officiel/)
    expect(mocks.requireAuthApi).not.toHaveBeenCalled()
    expect(mocks.varieteCreate).not.toHaveBeenCalled()
  })
})

describe("delete_variete_perso (DELETE /api/varietes/[id])", () => {
  it("nominal : variété perso sans culture supprimée", async () => {
    mocks.varieteFindFirst.mockResolvedValue({ id: "v1", userId: tenant, _count: { cultures: 0 } })
    expect(await lancer("delete_variete_perso", { varieteId: "v1" })).toEqual({ succes: true })
    expect(mocks.varieteDelete).toHaveBeenCalledWith({ where: { id: "v1" } })
  })

  it("refus d'upstream : variété utilisée par des cultures (409), rien n'est supprimé", async () => {
    mocks.varieteFindFirst.mockResolvedValue({ id: "v1", userId: tenant, _count: { cultures: 2 } })
    const res = await lancer("delete_variete_perso", { varieteId: "v1" })
    expect(res.erreur).toMatch(/utilisée par 2 culture\(s\)/)
    expect(mocks.varieteDelete).not.toHaveBeenCalled()
  })

  it("refus d'upstream : variété d'un autre compte (403)", async () => {
    mocks.varieteFindFirst.mockResolvedValue({ id: "v1", userId: "autre", partageCommunaute: true, _count: { cultures: 0 } })
    const res = await lancer("delete_variete_perso", { varieteId: "v1" })
    expect(res.erreur).toBe("Vous ne pouvez supprimer que vos propres variétés.")
    expect(mocks.varieteDelete).not.toHaveBeenCalled()
  })
})

describe("delete_culture (DELETE /api/cultures/[id])", () => {
  beforeEach(() => {
    mocks.cultureFindUnique.mockResolvedValue({ id: 42, especeId: "Tomate", userId: tenant })
  })

  it("nominal : culture sans récolte supprimée, cache KPI", async () => {
    expect(await lancer("delete_culture", { cultureId: 42 })).toEqual({ succes: true, supprimee: 42 })
    expect(mocks.cultureDelete).toHaveBeenCalledWith({ where: { id: 42 } })
    expect(mocks.invalidateKpi).toHaveBeenCalledWith(tenant)
  })

  it("refus d'upstream : une récolte vendue retient la culture (409), AUCUNE vente n'est supprimée", async () => {
    mocks.recolteFindMany.mockResolvedValue([
      { id: 1, statut: "vendu", factureId: null },
      { id: 2, statut: "en_stock", factureId: null },
    ])
    mocks.venteFindMany.mockResolvedValue([{ sourceId: 1 }])
    const res = await lancer("delete_culture", { cultureId: 42 })
    expect(res.erreur).toMatch(/a 1 récolte vendue sur 2 \(1 vente en comptabilité\)/)
    expect(mocks.venteDeleteMany).not.toHaveBeenCalled()
    expect(mocks.cultureDelete).not.toHaveBeenCalled()
  })

  it("refus d'upstream : lots liés à des bons ou factures (409)", async () => {
    mocks.stockCommercialCount.mockResolvedValue(1)
    const res = await lancer("delete_culture", { cultureId: 42 })
    expect(res.erreur).toMatch(/bons ou factures/)
    expect(mocks.cultureDelete).not.toHaveBeenCalled()
  })

  it("refus d'upstream : culture d'un autre compte (404)", async () => {
    mocks.cultureFindUnique.mockResolvedValue(null)
    expect((await lancer("delete_culture", { cultureId: 7 })).erreur).toBe("Culture #7 non trouvée")
  })
})

describe("erreurs techniques : jamais de détail technique au modèle", () => {
  it("exception de la base : message générique, sans le texte de l'exception", async () => {
    mocks.cultureFindUnique.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432 /srv/app/db.js"))
    const res = await lancer("delete_culture", { cultureId: 42 })
    expect(res.erreur).toMatch(/Erreur interne/)
    expect(JSON.stringify(res)).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|srv/)
  })

  it("session absente (hors requête) : 401 d'upstream, rien n'est écrit", async () => {
    const { NextResponse } = await import("next/server")
    mocks.requireAuthApi.mockResolvedValue({ error: NextResponse.json({ error: "Non autorisé" }, { status: 401 }), session: null })
    const res = await lancer("delete_culture", { cultureId: 42 })
    expect(res.erreur).toBe("Non autorisé")
    expect(mocks.cultureDelete).not.toHaveBeenCalled()
  })
})

describe("garde lecture seule du plugin", () => {
  const ecritures = outilsChat.map((o) => o.name).filter((n) => !n.startsWith("get_"))

  it("couvre exactement les 10 outils d'écriture", () => {
    expect(ecritures.sort()).toEqual(
      [
        "create_culture", "create_intervention", "create_objet_jardin", "create_planche", "create_variete_perso",
        "delete_culture", "delete_objet_jardin", "delete_planche", "delete_variete_perso", "update_culture",
      ].sort(),
    )
  })

  it.each(ecritures)("%s est refusé pour un membre en consultation : aucune route appelée", async (nom) => {
    const res = JSON.parse(
      await executerAvecDroitsChat({ peutEcrire: false }, () => executerOutil(nom, JSON.stringify({ cultureId: 1, nom: "A1" }), tenant)),
    )
    expect(res.erreur).toMatch(/lecture seule/i)
    expect(mocks.requireAuthApi).not.toHaveBeenCalled()
    expect(mocks.cultureDelete).not.toHaveBeenCalled()
    expect(mocks.cultureCreate).not.toHaveBeenCalled()
  })

  it("l'en-tête de mutation du chat vaut « 0 » : la garde d'upstream ne se déclenche pas, la nôtre reste indispensable", async () => {
    // Preuve par construction : le helper ne transmet jamais cet en-tête, et executerOutil refuse seul.
    mocks.cultureFindUnique.mockResolvedValue({ id: 42, especeId: "Tomate", userId: tenant })
    await lancer("delete_culture", { cultureId: 42 })
    const reçu = mocks.requireAuthApi.mock.calls[0]
    expect(reçu).toEqual([]) // upstream appelle requireAuthApi() sans argument
  })

  it("les lectures restent permises en consultation", async () => {
    mocks.especeFindMany.mockResolvedValue([])
    const res = await executerAvecDroitsChat({ peutEcrire: false }, () => executerOutil("get_especes", "{}", tenant))
    expect(JSON.parse(res)).toEqual([])
  })
})

describe("contrat : plus d'écriture Prisma directe dans les outils", () => {
  it("chat-tools.ts n'appelle aucun create/update/delete/upsert de Prisma", () => {
    const source = readFileSync(join(__dirname, "../chat-tools.ts"), "utf8")
    expect(source).not.toMatch(/prisma\.\w+\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\b/)
    expect(source).not.toMatch(/\$transaction|\$executeRaw/)
  })
})
