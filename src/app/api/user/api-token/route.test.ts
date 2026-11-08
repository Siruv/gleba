/**
 * /api/user/api-token : le jeton appartient à la PERSONNE (acteur), pas au tenant.
 *
 * Régression couverte (audit pluginAssistantAuditOutils, 3.2) : la route
 * utilisait `session.user.id`, qui est le tenant. Un membre (même en
 * consultation) obtenait un jeton posé sur le compte du propriétaire.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuthApi: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
}))

vi.mock("@/lib/auth-utils", () => ({ requireAuthApi: mocks.requireAuthApi }))
vi.mock("@/lib/prisma", () => ({
  default: { user: { findUnique: mocks.userFindUnique, update: mocks.userUpdate } },
}))

import { DELETE, GET, POST } from "./route"

const sessionMembreConsultation = {
  user: { id: "proprio1", acteurId: "membre1", peutEcrireExploitation: false },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAuthApi.mockResolvedValue({ error: null, session: sessionMembreConsultation })
  mocks.userUpdate.mockResolvedValue({ apiToken: "glb_test" })
  mocks.userFindUnique.mockResolvedValue({ apiToken: "glb_factice" })
})

describe("/api/user/api-token : identité = acteur", () => {
  it("POST pose le jeton sur l'acteur, jamais sur le tenant", async () => {
    await POST()
    expect(mocks.userUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.userUpdate.mock.calls[0][0].where).toEqual({ id: "membre1" })
  })

  it("GET lit le jeton de l'acteur, pas celui du propriétaire", async () => {
    await GET()
    expect(mocks.userFindUnique.mock.calls[0][0].where).toEqual({ id: "membre1" })
  })

  it("DELETE révoque le jeton de l'acteur, pas celui du propriétaire", async () => {
    await DELETE()
    expect(mocks.userUpdate.mock.calls[0][0].where).toEqual({ id: "membre1" })
  })

  it("sans adhésion (acteur = tenant), l'identifiant reste celui du compte", async () => {
    mocks.requireAuthApi.mockResolvedValue({ error: null, session: { user: { id: "solo1" } } })
    await POST()
    expect(mocks.userUpdate.mock.calls[0][0].where).toEqual({ id: "solo1" })
  })
})
