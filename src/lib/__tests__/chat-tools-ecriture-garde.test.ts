/**
 * Garde lecture seule : le VRAI `requireAuthApi` d'upstream, appelé par un
 * handler en processus depuis /api/chat, ne refuse pas un membre en
 * consultation (l'en-tête de mutation vaut « 0 » pour ce chemin). Le refus
 * explicite de `executerOutil` est donc indispensable ; /api/mcp reste en
 * lecture seule.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  auth: vi.fn(),
  resoudreContexte: vi.fn(),
  cultureFindUnique: vi.fn(),
  cultureDelete: vi.fn(),
}))

vi.mock("next/headers", () => ({ headers: mocks.headers }))
vi.mock("next/navigation", () => ({ redirect: vi.fn() }))
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/activity", () => ({ touchActivity: vi.fn() }))
vi.mock("@/lib/exploitation/membres", () => ({ resoudreContexteExploitation: mocks.resoudreContexte }))
vi.mock("@/lib/kpi", () => ({ invalidateKpi: vi.fn(), getKpiMaraichage: vi.fn() }))
vi.mock("@/lib/irrigation-cache", () => ({ irrigationCache: { invalidateUser: vi.fn() } }))
vi.mock("@/lib/prisma", () => ({
  default: {
    culture: { findUnique: mocks.cultureFindUnique },
    mouvementStockCommercial: { count: vi.fn().mockResolvedValue(0) },
    recolte: { findMany: vi.fn().mockResolvedValue([]) },
    venteManuelle: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: (fn: (t: unknown) => unknown) => fn({ venteManuelle: { deleteMany: vi.fn() }, culture: { delete: mocks.cultureDelete } }),
  },
}))

import { executerAvecDroitsChat, executerOutil } from "../chat-tools"
import { appelerRouteUpstream } from "../chat/appelRouteUpstream"
import { DELETE } from "@/app/api/cultures/[id]/route"

const consultation = {
  tenantId: "proprio1", acteurId: "membre1", role: "CONSULTATION", modules: null, estProprietaire: false, peutEcrire: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: "membre1", role: "USER" }, expires: "2099-01-01" })
  mocks.resoudreContexte.mockResolvedValue(consultation)
  mocks.cultureFindUnique.mockResolvedValue({ id: 42, especeId: "Tomate", userId: "proprio1" })
})

describe("garde lecture seule avec le vrai requireAuthApi", () => {
  it("chemin /api/chat (en-tête « 0 ») : la garde d'upstream laisse passer un membre en consultation", async () => {
    mocks.headers.mockResolvedValue(new Headers({ cookie: "c=1", "x-gleba-mutation": "0" }))
    const res = await appelerRouteUpstream(DELETE, { methode: "DELETE", chemin: "/api/cultures/42", params: { id: "42" } })
    // Preuve du constat d'audit 3.1 : sans notre refus, l'écriture aboutirait.
    expect(res.ok).toBe(true)
    expect(mocks.cultureDelete).toHaveBeenCalled()
  })

  it("en-tête « 1 » (route d'exploitation normale) : la garde d'upstream refuse en 403", async () => {
    mocks.headers.mockResolvedValue(new Headers({ cookie: "c=1", "x-gleba-mutation": "1" }))
    const res = await appelerRouteUpstream(DELETE, { methode: "DELETE", chemin: "/api/cultures/42", params: { id: "42" } })
    expect(res).toMatchObject({ ok: false, statut: 403 })
    expect(mocks.cultureDelete).not.toHaveBeenCalled()
  })

  it("executerOutil refuse le même membre AVANT toute route, quel que soit l'en-tête", async () => {
    mocks.headers.mockResolvedValue(new Headers({ cookie: "c=1", "x-gleba-mutation": "0" }))
    const res = JSON.parse(
      await executerAvecDroitsChat({ peutEcrire: false }, () => executerOutil("delete_culture", '{"cultureId":42}', "proprio1")),
    )
    expect(res.erreur).toMatch(/lecture seule/i)
    expect(mocks.auth).not.toHaveBeenCalled()
    expect(mocks.cultureDelete).not.toHaveBeenCalled()
  })

  it("sans contexte de requête (headers() lève) : auth() rend null, 401, rien n'est écrit", async () => {
    mocks.headers.mockRejectedValue(new Error("hors requête"))
    mocks.auth.mockResolvedValue(null)
    const res = await appelerRouteUpstream(DELETE, { methode: "DELETE", chemin: "/api/cultures/42", params: { id: "42" } })
    expect(res).toMatchObject({ ok: false, statut: 401 })
    expect(mocks.cultureDelete).not.toHaveBeenCalled()
  })
})

describe("garde par requête (executerOutil avec contexte)", () => {
  it("sans contexte, executerOutil garde son comportement (rétrocompatible, /api/mcp)", async () => {
    const resultat = JSON.parse(await executerOutil("outil_inconnu", "{}", "u1"))
    expect(resultat.erreur).toContain("Outil inconnu")
  })

  it("les lectures (get_) ne passent pas par la garde", async () => {
    const { creerGardeEcritures } = await import("../chat/gardeEcritures")
    const garde = creerGardeEcritures()
    const espion = vi.spyOn(garde, "executer")
    await executerOutil("get_inconnu", "{}", "u1", { garde })
    await executerOutil("get_inconnu", "{}", "u1", { garde })
    expect(espion).not.toHaveBeenCalled()
  })
})
