/**
 * fetchDailyBriefing : l'identité vient de la session serveur, jamais du client
 * (audit pluginAssistantAuditOutils, 3.4).
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  dejaAffiche: vi.fn(),
  marquer: vi.fn(),
  donnees: vi.fn(),
}))

vi.mock("@/lib/auth-utils", () => ({ requireAuth: mocks.requireAuth }))
vi.mock("@/lib/chat/daily-opening", () => ({
  hasAlreadyShownBriefingToday: mocks.dejaAffiche,
  markBriefingAsShown: mocks.marquer,
}))
vi.mock("@/lib/chat/daily-briefing", () => ({ getDailyBriefingData: mocks.donnees }))

import { fetchDailyBriefing } from "./chat-briefing"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAuth.mockResolvedValue({ user: { id: "tenant1", acteurId: "membre1" } })
  mocks.dejaAffiche.mockResolvedValue(false)
  mocks.donnees.mockResolvedValue({ taches: [], alertesMeteo: [], alertesUrgentes: [] })
})

describe("fetchDailyBriefing", () => {
  it("n'accepte aucun paramètre : la fonction ne peut pas viser un autre compte", () => {
    expect(fetchDailyBriefing.length).toBe(0)
  })

  it("ignore un identifiant glissé par un client et lit la session", async () => {
    await (fetchDailyBriefing as unknown as (id: string) => Promise<unknown>)("victime")
    expect(mocks.donnees).toHaveBeenCalledWith("tenant1")
    expect(mocks.donnees).not.toHaveBeenCalledWith("victime")
    expect(mocks.marquer).toHaveBeenCalledWith("membre1")
  })

  it("rend null sans rien lire si le briefing a déjà été affiché à la personne", async () => {
    mocks.dejaAffiche.mockResolvedValue(true)
    expect(await fetchDailyBriefing()).toBeNull()
    expect(mocks.dejaAffiche).toHaveBeenCalledWith("membre1")
    expect(mocks.donnees).not.toHaveBeenCalled()
  })
})
