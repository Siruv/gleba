import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { outilsFormatOpenAI, envoyerMessageAvecOutils } from "@/lib/chat-openai-tools"

describe("chat-openai-tools", () => {
  let mockFetch: any

  beforeEach(() => {
    mockFetch = vi.fn()
    global.fetch = mockFetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("devrait formater les outils au format OpenAI", async () => {
    // Mock simple des outils
    vi.mock("@/lib/chat-tools", () => ({
      outilsChat: [
        {
          name: "test_tool",
          description: "Outil de test",
          parameters: { param1: "value1" },
        },
      ],
    }))

    const outils = await outilsFormatOpenAI()
    expect(Array.isArray(outils)).toBe(true)
    expect(outils.length).toBe(1)
    
    const premierOutil = outils[0]
    expect(premierOutil).toHaveProperty("type", "function")
    expect(premierOutil).toHaveProperty("function")
    expect(premierOutil.function).toHaveProperty("name", "test_tool")
    expect(premierOutil.function).toHaveProperty("description", "Outil de test")
    expect(premierOutil.function).toHaveProperty("parameters")
  })

  it("devrait envoyer un message simple sans outils", async () => {
    const mockResponse = {
      choices: [{
        message: {
          content: "Réponse simple",
        },
      }],
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    })

    const result = await envoyerMessageAvecOutils(
      "https://api.mistral.ai/v1",
      "test-api-key",
      "mistral-small-latest",
      "Système de test",
      [{ role: "user", content: "Bonjour" }]
    )

    expect(result).toBe("Réponse simple")
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("devrait gérer les erreurs d'API", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: "Unauthorized" }),
      text: () => Promise.resolve("Unauthorized"),
    })

    await expect(envoyerMessageAvecOutils(
      "https://api.mistral.ai/v1",
      "test-api-key",
      "mistral-small-latest",
      "Système de test",
      [{ role: "user", content: "Bonjour" }]
    )).rejects.toThrow("Erreur API (HTTP 401)")
  })

  it("devrait gérer les réponses invalides", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    })

    await expect(envoyerMessageAvecOutils(
      "https://api.mistral.ai/v1",
      "test-api-key",
      "mistral-small-latest",
      "Système de test",
      [{ role: "user", content: "Bonjour" }]
    )).rejects.toThrow("Réponse invalide : pas de choix dans la réponse.")
  })
})
