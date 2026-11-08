/**
 * Garde des écritures par SENS : l'identité d'une écriture est le corps réellement
 * envoyé à la route d'upstream (valeurs par défaut appliquées, noms résolus en
 * identifiants), pas les arguments bruts du modèle.
 *
 * Preuve tirée d'un test réel (journaux OmniRoute du 2026-11-08, 17:16:15 à 17:16:35) :
 * un modèle en cascade a appelé create_culture trois fois pour Chou brocoli sur A1
 * avec les formes A, B et C ci-dessous ; les cultures 47 et 48 ont été créées.
 */

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
  varieteFindMany: vi.fn(),
  itpFindFirst: vi.fn(),
  plancheFindMany: vi.fn(),
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
      variete: { findFirst: mocks.varieteFindFirst, findMany: mocks.varieteFindMany, delete: mocks.varieteDelete },
      iTP: { findFirst: mocks.itpFindFirst },
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
        findMany: mocks.plancheFindMany,
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

import { executerAvecDroitsChat, executerOutil } from "../chat-tools"

import { creerGardeEcritures, CONSIGNE_ECRITURE_REPETEE, type GardeEcritures } from "../chat/gardeEcritures"

const tenant = "u1"
const session = { user: { id: tenant, role: "USER", peutEcrireExploitation: true } }

const formeA = '{"especeNom":"Chou brocoli","notes":"TEST_CHAT_A_SUPPRIMER","plancheNom":"A1","semisFait":false,"annee":2026}'
const formeB = '{"semisFait":false,"notes":"TEST_CHAT_A_SUPPRIMER","especeNom":"Chou brocoli","plantationFaite":false,"plancheNom":"A1"}'
const formeC = '{"especeNom":"Chou brocoli","annee":2026,"semisFait":false,"notes":"TEST_CHAT_A_SUPPRIMER","plancheNom":"A1"}'

const lancer = async (garde: GardeEcritures, nom: string, args: string, userId = tenant) =>
  JSON.parse(await executerAvecDroitsChat({ peutEcrire: true }, () => executerOutil(nom, args, userId, { garde })))

let sequence = 0

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-08T12:00:00"))
  sequence = 100
  mocks.headers.mockResolvedValue(new Headers({ cookie: "authjs.session-token=abc", "x-gleba-mutation": "0" }))
  mocks.requireAuthApi.mockResolvedValue({ error: null, session })
  mocks.getSession.mockResolvedValue(session)
  mocks.checkRotation.mockResolvedValue(null)
  mocks.stockCommercialCount.mockResolvedValue(0)
  mocks.venteFindMany.mockResolvedValue([])
  mocks.recolteFindMany.mockResolvedValue([])
  mocks.cultureGroupBy.mockResolvedValue([])
  mocks.interventionGroupBy.mockResolvedValue([])
  mocks.especeFindMany.mockResolvedValue([{ id: "ChouBrocoli", nom: "Chou brocoli", userId: null }])
  mocks.especeFindFirst.mockResolvedValue({ id: "ChouBrocoli", nom: "Chou brocoli", besoinEau: 1, irrigation: null })
  mocks.varieteFindMany.mockResolvedValue([])
  const planches: Record<string, { id: string; nom: string }> = {
    a1: { id: "pl-a1", nom: "A1" },
    a2: { id: "pl-a2", nom: "A2" },
  }
  mocks.plancheFindMany.mockImplementation(async ({ where }: { where: { nom?: { equals?: string } } }) => {
    const trouvee = planches[(where.nom?.equals ?? "").toLowerCase()]
    return trouvee ? [trouvee] : []
  })
  const lirePlanche = async ({ where }: { where: { id: string } }) => {
    const trouvee = Object.values(planches).find((p) => p.id === where.id)
    return trouvee ? { ...trouvee, userId: tenant, largeur: 1, longueur: 10, cultures: [] } : null
  }
  mocks.plancheFindFirst.mockImplementation(lirePlanche)
  mocks.plancheFindUnique.mockImplementation(lirePlanche)
  mocks.cultureCreate.mockImplementation(async ({ data }) => ({
    id: ++sequence, annee: data.annee, semisFait: data.semisFait, plantationFaite: data.plantationFaite,
    espece: { nom: "Chou brocoli" }, planche: null, variete: null, itp: null, notes: data.notes ?? null,
  }))
  mocks.cultureFindUnique.mockResolvedValue({ id: 42, especeId: "ChouBrocoli", userId: tenant })
})

describe("garde par sens : create_culture (formes réelles A, B, C)", () => {
  it("(a) les formes A puis B puis C dans une même requête ne créent qu'UNE culture", async () => {
    const garde = creerGardeEcritures()
    const premier = await lancer(garde, "create_culture", formeA)
    const second = await lancer(garde, "create_culture", formeB)
    const troisieme = await lancer(garde, "create_culture", formeC)
    expect(mocks.cultureCreate).toHaveBeenCalledTimes(1)
    expect(premier.succes).toBe(true)
    // Le doublon renvoie la culture déjà créée (même id) et la consigne de conclure.
    expect(second.culture.id).toBe(premier.culture.id)
    expect(second.consigne).toBe(CONSIGNE_ECRITURE_REPETEE)
    expect(troisieme.culture.id).toBe(premier.culture.id)
    expect(troisieme.consigne).toBe(CONSIGNE_ECRITURE_REPETEE)
    expect(garde.realisees).toHaveLength(1)
  })

  it("(a bis) la forme B seule en premier, puis A : une seule création aussi", async () => {
    const garde = creerGardeEcritures()
    await lancer(garde, "create_culture", formeB)
    await lancer(garde, "create_culture", formeA)
    expect(mocks.cultureCreate).toHaveBeenCalledTimes(1)
  })

  it("(a ter) les formes A et B lancées en parallèle ne créent qu'UNE culture", async () => {
    const garde = creerGardeEcritures()
    await Promise.all([lancer(garde, "create_culture", formeA), lancer(garde, "create_culture", formeB)])
    expect(mocks.cultureCreate).toHaveBeenCalledTimes(1)
  })

  it("(b) deux requêtes concurrentes de comptes différents avec le même corps : deux créations isolées", async () => {
    mocks.plancheFindMany.mockImplementation(async () => [{ id: "pl-a1", nom: "A1" }])
    const [gardeU1, gardeU2] = [creerGardeEcritures(), creerGardeEcritures()]
    await Promise.all([lancer(gardeU1, "create_culture", formeA, "u1"), lancer(gardeU2, "create_culture", formeA, "u2")])
    expect(mocks.cultureCreate).toHaveBeenCalledTimes(2)
    expect(gardeU1.realisees).toHaveLength(1)
    expect(gardeU2.realisees).toHaveLength(1)
  })

  it("(c) la même espèce sur deux planches différentes : deux créations", async () => {
    const garde = creerGardeEcritures()
    await lancer(garde, "create_culture", formeA)
    const autre = await lancer(garde, "create_culture", formeA.replace('"A1"', '"A2"'))
    expect(mocks.cultureCreate).toHaveBeenCalledTimes(2)
    expect(autre.consigne).toBeUndefined()
  })

  it("(c bis) deux dates de semis différentes : deux créations", async () => {
    const garde = creerGardeEcritures()
    await lancer(garde, "create_culture", JSON.stringify({ especeNom: "Chou brocoli", plancheNom: "A1", dateSemis: "2026-03-01" }))
    await lancer(garde, "create_culture", JSON.stringify({ especeNom: "Chou brocoli", plancheNom: "A1", dateSemis: "2026-04-01" }))
    expect(mocks.cultureCreate).toHaveBeenCalledTimes(2)
  })

  it("(d) corps identique mais notes différentes : deux créations", async () => {
    const garde = creerGardeEcritures()
    await lancer(garde, "create_culture", formeA)
    await lancer(garde, "create_culture", formeA.replace("TEST_CHAT_A_SUPPRIMER", "autre note"))
    expect(mocks.cultureCreate).toHaveBeenCalledTimes(2)
  })

  it("une note vide ou absente ne change pas le sens", async () => {
    const garde = creerGardeEcritures()
    await lancer(garde, "create_culture", JSON.stringify({ especeNom: "Chou brocoli", plancheNom: "A1" }))
    await lancer(garde, "create_culture", JSON.stringify({ especeNom: "Chou brocoli", plancheNom: "A1", notes: "" }))
    expect(mocks.cultureCreate).toHaveBeenCalledTimes(1)
  })

  it("(f) une première écriture refusée (rotation) ne bloque pas la nouvelle tentative corrigée", async () => {
    const garde = creerGardeEcritures()
    mocks.checkRotation.mockResolvedValueOnce({ message: "Rotation non respectée : Chou après Chou.", violations: [] })
    const refus = await lancer(garde, "create_culture", formeA)
    expect(refus.erreur).toMatch(/Rotation non respectée/)
    const retente = await lancer(garde, "create_culture", formeB)
    expect(retente.succes).toBe(true)
    expect(mocks.cultureCreate).toHaveBeenCalledTimes(1)
  })

  it("(g) l'écriture refusée n'est pas comptée dans le plafond", async () => {
    const garde = creerGardeEcritures(2)
    await lancer(garde, "create_culture", JSON.stringify({ especeNom: "Chou brocoli", plancheNom: "Z9" })) // planche inconnue
    await lancer(garde, "create_culture", JSON.stringify({ especeNom: "Chou brocoli", plancheNom: "A1" }))
    // Un doublon par le sens n'est pas non plus compté : une seconde distincte passe encore sous le plafond de 2.
    await lancer(garde, "create_culture", JSON.stringify({ especeNom: "Chou brocoli", plancheNom: "A1", plantationFaite: false }))
    const distincte = await lancer(garde, "create_culture", JSON.stringify({ especeNom: "Chou brocoli", plancheNom: "A2" }))
    expect(distincte.succes).toBe(true)
    expect(mocks.cultureCreate).toHaveBeenCalledTimes(2)
  })
})

describe("garde par sens : suppressions", () => {
  it("(e) delete_culture du même id deux fois (écritures brutes différentes) : une seule suppression", async () => {
    const garde = creerGardeEcritures()
    const premier = await lancer(garde, "delete_culture", '{"cultureId":42}')
    const second = await lancer(garde, "delete_culture", '{"cultureId":"42"}')
    expect(premier).toEqual({ succes: true, supprimee: 42 })
    expect(second.consigne).toBe(CONSIGNE_ECRITURE_REPETEE)
    expect(mocks.cultureDelete).toHaveBeenCalledTimes(1)
  })
})
