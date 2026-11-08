/**
 * POST /api/chat : upstream exclut /api/chat du refus par méthode pour que
 * l'assistant reste consultable, et refuse les outils de MUTATION à
 * l'exécution. Le plugin pose ce refus : la route transmet le droit d'écrire.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAuthApi: vi.fn(),
  envoyerMessageChat: vi.fn(),
}))

vi.mock("@/lib/auth-utils", () => ({ requireAuthApi: mocks.requireAuthApi }))
vi.mock("@/lib/chat", () => ({ envoyerMessageChat: mocks.envoyerMessageChat }))
vi.mock("@/lib/prisma", () => ({ default: { culture: { findFirst: vi.fn().mockResolvedValue(null) } } }))
vi.mock("@/lib/chat-contexte", () => ({ construireContexteMeteo: vi.fn().mockResolvedValue(null) }))

import { POST } from "./route"
import { executerOutil } from "@/lib/chat-tools"

function requete() {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "supprime la culture 1" }] }),
  }) as never
}

beforeEach(() => {
  vi.clearAllMocks()
  // Le « modèle » tente une écriture pendant la requête.
  mocks.envoyerMessageChat.mockImplementation(async (_m: unknown, _s: unknown, _c: unknown, userId: string) =>
    executerOutil("delete_culture", JSON.stringify({ cultureId: 1 }), userId))
})

describe("POST /api/chat : lecture seule", () => {
  it("un membre en consultation : l'outil d'écriture est refusé, la réponse reste 200", async () => {
    mocks.requireAuthApi.mockResolvedValue({
      error: null,
      session: { user: { id: "proprio1", acteurId: "membre1", peutEcrireExploitation: false } },
    })
    const res = await POST(requete())
    expect(res.status).toBe(200)
    const { reply } = (await res.json()) as { reply: string }
    expect(JSON.parse(reply).erreur).toMatch(/lecture seule|ne permet pas/i)
  })

  it("un propriétaire : l'outil est tenté (pas de refus de droit)", async () => {
    mocks.requireAuthApi.mockResolvedValue({
      error: null,
      session: { user: { id: "proprio1", acteurId: "proprio1", peutEcrireExploitation: true } },
    })
    // Pas de base dans ce test : l'outil échoue pour une autre raison que le droit.
    const res = await POST(requete())
    const { reply } = (await res.json()) as { reply: string }
    expect(reply).not.toMatch(/lecture seule|ne permet pas de modifier/i)
  })
})
