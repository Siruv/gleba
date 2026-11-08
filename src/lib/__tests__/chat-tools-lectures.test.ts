/**
 * Lectures de l'assistant alignées sur les règles d'upstream (phase 2b).
 * Deux comptes (A et B) partagent une base simulée : un évaluateur minimal de
 * `where` Prisma filtre les lignes, ce qui prouve la règle réellement appliquée
 * et pas seulement la forme de la requête.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

type Ligne = Record<string, unknown>

const bd = vi.hoisted(() => ({
  itps: [] as Record<string, unknown>[],
  cultures: [] as Record<string, unknown>[],
  recoltes: [] as Record<string, unknown>[],
  zone: null as string | null,
  kpi: vi.fn(),
  recolteFindMany: vi.fn(),
}))

/** Évalue le sous-ensemble de `where` Prisma utilisé par les outils de lecture. */
function correspond(ligne: Ligne, where: Ligne | undefined): boolean {
  if (!where) return true
  return Object.entries(where).every(([cle, attendu]) => {
    if (cle === "AND") return (attendu as Ligne[]).every((w) => correspond(ligne, w))
    if (cle === "OR") return (attendu as Ligne[]).some((w) => correspond(ligne, w))
    const valeur = ligne[cle]
    if (attendu !== null && typeof attendu === "object") {
      const a = attendu as { not?: unknown; in?: unknown[] }
      if ("not" in a) return valeur !== a.not
      if ("in" in a) return a.in!.includes(valeur)
    }
    return valeur === attendu
  })
}

vi.mock("@/lib/prisma", () => ({
  default: {
    iTP: {
      findMany: vi.fn(async (args: { where?: Ligne; take?: number }) =>
        bd.itps.filter((i) => correspond(i, args.where)).slice(0, args.take ?? Infinity)),
    },
    culture: {
      findMany: vi.fn(async (args: { where?: Ligne; take?: number }) =>
        bd.cultures.filter((c) => correspond(c, args.where)).slice(0, args.take ?? Infinity)),
    },
    recolte: { findMany: bd.recolteFindMany },
  },
}))
vi.mock("@/lib/terroir", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/terroir")>()),
  zoneEffectiveUser: vi.fn(async () => bd.zone),
}))
vi.mock("@/lib/kpi", () => ({ invalidateKpi: vi.fn(), getKpiMaraichage: bd.kpi }))
vi.mock("@/lib/meteo", () => ({ fetchOpenMeteoForecast: vi.fn() }))

import { executerOutil } from "../chat-tools"

const itp = (id: string, extra: Ligne = {}): Ligne => ({
  id, actif: true, userId: null, partageCommunaute: false, zoneClimat: null,
  espece: { nom: `Esp-${id}` }, semaineSemis: 10, semainePlantation: 14, semaineRecolte: 24,
  dureeCulture: 90, ...extra,
})

const cult = (id: number, userId: string, extra: Ligne = {}): Ligne => ({
  id, userId, annee: 2026, terminee: null, semisFait: false, plantationFaite: false, recolteFaite: false,
  espece: { nom: "Tomate" }, variete: null, planche: null, ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  bd.zone = null
  bd.itps = [
    itp("officiel"),
    itp("officielInactif", { actif: false }),
    itp("perso-A", { userId: "A" }),
    itp("perso-B", { userId: "B" }),
    itp("partage-B", { userId: "B", partageCommunaute: true }),
    itp("tropical", { zoneClimat: "tropical_antilles" }),
  ]
  bd.cultures = [
    cult(1, "A"),
    cult(2, "A", { recolteFaite: true }), // récoltée sans semis enregistré
    cult(3, "A", { semisFait: true }),
    cult(4, "B"),
  ]
})

describe("get_planification : accès aux ITP d'upstream", () => {
  it("voit les ITP officiels, partagés et les siens, jamais le privé d'un autre ni l'inactif", async () => {
    const ids = (JSON.parse(await executerOutil("get_planification", "{}", "A")) as { id: string }[]).map((i) => i.id)
    expect(ids.sort()).toEqual(["officiel", "partage-B", "perso-A"])
  })

  it("le compte B ne voit pas l'ITP privé de A", async () => {
    const ids = (JSON.parse(await executerOutil("get_planification", "{}", "B")) as { id: string }[]).map((i) => i.id)
    expect(ids).toContain("perso-B")
    expect(ids).not.toContain("perso-A")
  })

  it("applique la règle de zone : un compte d'outre-mer ne voit que les ITP de sa zone", async () => {
    bd.zone = "tropical_antilles"
    const ids = (JSON.parse(await executerOutil("get_planification", "{}", "A")) as { id: string }[]).map((i) => i.id)
    expect(ids).toEqual(["tropical"])
  })
})

describe("get_cultures : état d'upstream (whereEtatCulture / etatCulture)", () => {
  it("« Planifiée » exclut la culture récoltée sans semis et les cultures de B", async () => {
    const r = JSON.parse(await executerOutil("get_cultures", JSON.stringify({ etat: "Planifiée" }), "A")) as { id: number; etat: string }[]
    expect(r.map((c) => c.id)).toEqual([1])
    expect(r[0].etat).toBe("Planifiée")
  })

  it("« En récolte » rend la culture récoltée avec l'état affiché par upstream", async () => {
    const r = JSON.parse(await executerOutil("get_cultures", JSON.stringify({ etat: "En récolte" }), "A")) as { id: number; etat: string }[]
    expect(r).toEqual([expect.objectContaining({ id: 2, etat: "En récolte" })])
  })

  it("refuse un état inconnu au lieu de le prendre pour « tout »", async () => {
    const r = JSON.parse(await executerOutil("get_cultures", JSON.stringify({ etat: "Bidule" }), "A")) as { erreur?: string }
    expect(r.erreur).toContain("Planifiée")
  })
})

describe("get_recoltes : unité et année", () => {
  it("rend la quantité avec son unité (jamais des tiges annoncées en kg)", async () => {
    bd.recolteFindMany.mockResolvedValue([
      { date: new Date("2026-05-01"), espece: { nom: "Tulipe" }, quantite: 40, unite: "tige", statut: "en_stock" },
      { date: new Date("2026-05-02"), espece: { nom: "Tomate" }, quantite: 3, unite: null, statut: "en_stock" },
    ])
    const r = JSON.parse(await executerOutil("get_recoltes", "{}", "A")) as Record<string, unknown>[]
    expect(r[0]).toMatchObject({ quantite: 40, unite: "tige" })
    expect(r[0]).not.toHaveProperty("quantiteKg")
    expect(r[1]).toMatchObject({ quantite: 3, unite: "kg" })
  })

  it("une année invalide retombe sur l'année civile, la requête reste bornée au compte", async () => {
    bd.recolteFindMany.mockResolvedValue([])
    await executerOutil("get_recoltes", JSON.stringify({ annee: "abc" }), "A")
    const where = bd.recolteFindMany.mock.calls[0][0].where
    expect(where.userId).toBe("A")
    expect(Number.isNaN(where.date.gte.getTime())).toBe(false)
  })
})

describe("get_dashboard_stats : source de vérité KPI", () => {
  it("lit getKpiMaraichage pour le tenant et l'année civile", async () => {
    bd.kpi.mockResolvedValue({
      surfaceCultiveeM2: 120, surfacePlanifieeM2: 200, recoltesKgYtd: 50,
      recoltesParUniteYtd: { kg: 50, tige: 40 }, culturesActives: 7, culturesPlanifiees: 12,
      culturesTerminees: 3, planchesCount: 9, planchesSurfaceM2: 300,
    })
    const r = JSON.parse(await executerOutil("get_dashboard_stats", "{}", "A")) as Record<string, unknown>
    expect(bd.kpi).toHaveBeenCalledWith("A", new Date().getFullYear(), expect.any(Date))
    expect(r).toMatchObject({ culturesActives: 7, surfaceCultiveeM2: 120, recoltesParUniteYtd: { kg: 50, tige: 40 } })
    expect(r).not.toHaveProperty("tachesSemaine")
  })
})
