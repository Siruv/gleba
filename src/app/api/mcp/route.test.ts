/**
 * /api/mcp : contrat public d'upstream (docs/integrations-elevage.md) et
 * sécurité du jeton (audit pluginAssistantAuditOutils, 3.2).
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  resoudreContexte: vi.fn(),
  executerOutil: vi.fn(),
  checkRateLimit: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ default: { user: { findUnique: mocks.userFindUnique } } }))
vi.mock("@/lib/exploitation/membres", () => ({ resoudreContexteExploitation: mocks.resoudreContexte }))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit, getClientIP: () => "127.0.0.1" }))
vi.mock("@/lib/chat-tools", async () => {
  const reel = await vi.importActual<typeof import("@/lib/chat-tools")>("@/lib/chat-tools")
  return { ...reel, executerOutil: mocks.executerOutil }
})

import { GET, POST } from "./route"

const jeton = "glb_0123456789abcdef0123456789abcdef0123456789abcdef"

function requete(methode: "GET" | "POST", options: { token?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  const token = options.token === undefined ? jeton : options.token
  if (token !== null) headers.Authorization = `Bearer ${token}`
  return new Request("http://localhost/api/mcp", {
    method: methode,
    headers,
    body: methode === "POST" ? JSON.stringify(options.body ?? {}) : undefined,
  }) as never
}

const contexteMembre = {
  tenantId: "proprio1",
  acteurId: "membre1",
  role: "CONSULTATION",
  modules: null,
  estProprietaire: false,
  peutEcrire: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.userFindUnique.mockResolvedValue({ id: "membre1", apiToken: jeton })
  mocks.resoudreContexte.mockResolvedValue(contexteMembre)
  mocks.executerOutil.mockResolvedValue(JSON.stringify([{ id: 1 }]))
  mocks.checkRateLimit.mockReturnValue(null)
})

describe("authentification", () => {
  it("401 générique sans jeton, avec un jeton sans préfixe glb_ et avec un jeton inconnu", async () => {
    const messages = new Set<string>()
    for (const token of [null, "", "abc", "glb_inconnu"]) {
      mocks.userFindUnique.mockResolvedValue(null)
      const res = await POST(requete("POST", { token, body: { tool: "get_planches" } }))
      expect(res.status).toBe(401)
      messages.add(JSON.stringify(await res.json()))
    }
    expect(messages.size).toBe(1)
  })

  it("ne cherche pas en base un jeton qui n'a pas le préfixe glb_", async () => {
    await POST(requete("POST", { token: "abc", body: { tool: "get_planches" } }))
    expect(mocks.userFindUnique).not.toHaveBeenCalled()
  })

  it("résout le contexte d'exploitation de l'acteur et exécute avec le tenant", async () => {
    const res = await POST(requete("POST", { body: { tool: "get_planches", args: { search: "a" } } }))
    expect(res.status).toBe(200)
    expect(mocks.resoudreContexte).toHaveBeenCalledWith("membre1")
    expect(mocks.executerOutil).toHaveBeenCalledWith("get_planches", JSON.stringify({ search: "a" }), "proprio1")
    expect(await res.json()).toEqual({ result: [{ id: 1 }] })
  })
})

describe("limite de débit", () => {
  it("200 requêtes par 15 minutes, clé dérivée d'un hachage, jamais le jeton", async () => {
    await POST(requete("POST", { body: { tool: "get_planches" } }))
    const [cle, options] = mocks.checkRateLimit.mock.calls[0]
    expect(cle).not.toContain(jeton)
    expect(cle).not.toContain("0123456789abcdef")
    expect(options).toEqual({ windowMs: 15 * 60 * 1000, max: 200 })
  })

  it("répond 429 quand la limite est atteinte et n'exécute rien", async () => {
    const reel = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit")
    mocks.checkRateLimit.mockImplementation(reel.checkRateLimit)
    mocks.userFindUnique.mockResolvedValue({ id: "membre2", apiToken: jeton })
    let dernier = 200
    for (let i = 0; i < 201; i++) {
      dernier = (await POST(requete("POST", { body: { tool: "get_planches" } }))).status
    }
    expect(dernier).toBe(429)
    expect(mocks.executerOutil).toHaveBeenCalledTimes(200)
  })

  it("la limite s'applique aussi à GET", async () => {
    const reel = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit")
    mocks.checkRateLimit.mockImplementation(reel.checkRateLimit)
    const autre = "glb_autrejeton000000000000000000000000000000000000"
    mocks.userFindUnique.mockResolvedValue({ id: "membre3", apiToken: autre })
    let dernier = 200
    for (let i = 0; i < 201; i++) dernier = (await GET(requete("GET", { token: autre }))).status
    expect(dernier).toBe(429)
  })
})

describe("GET /api/mcp : liste des outils", () => {
  it("exige un jeton valide", async () => {
    mocks.userFindUnique.mockResolvedValue(null)
    expect((await GET(requete("GET", { token: null }))).status).toBe(401)
  })

  it("liste les outils de lecture exécutables, sans outil d'écriture", async () => {
    const res = await GET(requete("GET"))
    expect(res.status).toBe(200)
    const corps = (await res.json()) as { tools: Array<{ name: string; description: string; parameters: unknown }> }
    expect(corps.tools.length).toBeGreaterThan(0)
    expect(corps.tools.every((o) => o.name.startsWith("get_"))).toBe(true)
    expect(corps.tools.map((o) => o.name)).toContain("get_especes")
    expect(corps.tools[0]).toHaveProperty("description")
    expect(corps.tools[0]).toHaveProperty("parameters")
  })
})

describe("POST /api/mcp : corps et section", () => {
  it("400 sans champ tool", async () => {
    expect((await POST(requete("POST", { body: { args: {} } }))).status).toBe(400)
  })

  it("accepte section optionnelle, 400 si elle n'est pas une chaîne", async () => {
    expect((await POST(requete("POST", { body: { tool: "get_planches", section: "potager" } }))).status).toBe(200)
    expect((await POST(requete("POST", { body: { tool: "get_planches", section: 12 } }))).status).toBe(400)
  })

  it("400 si args n'est pas un objet", async () => {
    expect((await POST(requete("POST", { body: { tool: "get_planches", args: "x" } }))).status).toBe(400)
  })

  it("400 pour un outil de lecture inconnu", async () => {
    const res = await POST(requete("POST", { body: { tool: "get_animaux", section: "elevage" } }))
    expect(res.status).toBe(400)
    expect(mocks.executerOutil).not.toHaveBeenCalled()
  })
})

describe("mode lecture seule", () => {
  it.each(["create_culture", "update_culture", "delete_culture", "create_planche", "create_animal", "mark_irrigation"])(
    "403 en français pour %s, même pour un propriétaire, et rien n'est exécuté",
    async (tool) => {
      mocks.resoudreContexte.mockResolvedValue({ ...contexteMembre, tenantId: "membre1", estProprietaire: true, role: "PROPRIETAIRE", peutEcrire: true })
      const res = await POST(requete("POST", { body: { tool, args: {} } }))
      expect(res.status).toBe(403)
      expect(((await res.json()) as { error: string }).error).toMatch(/lecture seule/i)
      expect(mocks.executerOutil).not.toHaveBeenCalled()
    },
  )
})

describe("erreurs internes", () => {
  it("ne renvoie jamais le message brut d'une exception", async () => {
    mocks.executerOutil.mockRejectedValue(new Error("secret de base de données"))
    const res = await POST(requete("POST", { body: { tool: "get_planches" } }))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain("secret")
  })
})
