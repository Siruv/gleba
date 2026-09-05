import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  executerOutil: vi.fn(),
}))

vi.mock("@/lib/chat-tools", () => ({
  executerOutil: mocks.executerOutil,
  outilsChat: [],
}))

describe("chat-anthropic-tools", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it("retourne le texte d'une réponse simple", async () => {
    const mockResponse = {
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: "text", text: "Bonjour, je suis Claude." }],
      }),
    }
    global.fetch.mockResolvedValue(mockResponse)

    const { envoyerMessageAnthropicAvecOutils } = await import("../chat-anthropic-tools")
    const resultat = await envoyerMessageAnthropicAvecOutils(
      "https://api.anthropic.com/v1",
      "test-key",
      "claude-sonnet",
      "Tu es un assistant agricole.",
      [{ role: "user", content: "Bonjour" }],
      undefined
    )

    expect(resultat).toBe("Bonjour, je suis Claude.")
  })

  it("exécute les outils et retourne la réponse finale", async () => {
    const mockResponse1 = {
      ok: true,
      json: () => Promise.resolve({
        content: [
          { type: "tool_use", id: "tool-1", name: "get_meteo_parcelles", input: {} },
        ],
      }),
    }
    const mockResponse2 = {
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: "text", text: "Voici la météo pour vos parcelles." }],
      }),
    }

    global.fetch.mockResolvedValueOnce(mockResponse1)
    global.fetch.mockResolvedValueOnce(mockResponse2)
    mocks.executerOutil.mockResolvedValue(JSON.stringify({ parcelles: [] }))

    const { envoyerMessageAnthropicAvecOutils } = await import("../chat-anthropic-tools")
    const resultat = await envoyerMessageAnthropicAvecOutils(
      "https://api.anthropic.com/v1",
      "test-key",
      "claude-sonnet",
      "Tu es un assistant agricole.",
      [{ role: "user", content: "Quelle est la météo ?" }],
      "user-test"
    )

    expect(resultat).toBe("Voici la météo pour vos parcelles.")
    expect(mocks.executerOutil).toHaveBeenCalledWith("get_meteo_parcelles", "{}", "user-test")
  })

  it("lève une erreur pour une réponse API invalide", async () => {
    const mockResponse = {
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    }
    global.fetch.mockResolvedValue(mockResponse)

    const { envoyerMessageAnthropicAvecOutils } = await import("../chat-anthropic-tools")

    await expect(
      envoyerMessageAnthropicAvecOutils(
        "https://api.anthropic.com/v1",
        "bad-key",
        "claude-sonnet",
        "System",
        [{ role: "user", content: "Test" }],
        undefined
      )
    ).rejects.toThrow("Erreur API Anthropic")
  })
})
