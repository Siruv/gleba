import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  executerOutil: vi.fn(),
}))

vi.mock("@/lib/chat-tools", () => ({
  executerOutil: mocks.executerOutil,
  outilsChat: [],
}))

describe("chat-ollama-tools", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it("retourne le texte d'une réponse simple", async () => {
    const mockResponse = {
      ok: true,
      json: () => Promise.resolve({
        message: { role: "assistant", content: "Bonjour, je suis un modèle Ollama." },
      }),
    }
    global.fetch.mockResolvedValue(mockResponse)

    const { envoyerMessageOllamaAvecOutils } = await import("../chat-ollama-tools")
    const resultat = await envoyerMessageOllamaAvecOutils(
      "http://localhost:11434",
      "llama3",
      "Tu es un assistant agricole.",
      [{ role: "user", content: "Bonjour" }],
      undefined
    )

    expect(resultat).toBe("Bonjour, je suis un modèle Ollama.")
  })

  it("exécute les outils et retourne la réponse finale", async () => {
    const mockResponse1 = {
      ok: true,
      json: () => Promise.resolve({
        message: {
          role: "assistant",
          content: "Je vais vérifier la météo.",
          tool_calls: [
            { function: { name: "get_meteo_parcelles", arguments: {} } },
          ],
        },
      }),
    }
    const mockResponse2 = {
      ok: true,
      json: () => Promise.resolve({
        message: { role: "assistant", content: "Voici la météo pour vos parcelles." },
      }),
    }

    global.fetch.mockResolvedValueOnce(mockResponse1)
    global.fetch.mockResolvedValueOnce(mockResponse2)
    mocks.executerOutil.mockResolvedValue(JSON.stringify({ parcelles: [] }))

    const { envoyerMessageOllamaAvecOutils } = await import("../chat-ollama-tools")
    const resultat = await envoyerMessageOllamaAvecOutils(
      "http://localhost:11434",
      "llama3",
      "Tu es un assistant agricole.",
      [{ role: "user", content: "Quelle est la météo ?" }],
      "user-test"
    )

    expect(resultat).toBe("Voici la météo pour vos parcelles.")
    expect(mocks.executerOutil).toHaveBeenCalledWith("get_meteo_parcelles", "{}", "user-test")
  })

  it("retombe en mode sans outils si le modèle ne supporte pas les tools", async () => {
    const mockResponse = {
      ok: true,
      json: () => Promise.resolve({
        message: { role: "assistant", content: "Je ne supporte pas les outils." },
      }),
    }

    // Premier appel échoue avec une erreur contenant "tool"
    const errorResponse = {
      ok: false,
      status: 400,
      text: () => Promise.resolve("Model does not support tools"),
    }

    global.fetch.mockResolvedValueOnce(errorResponse)
    global.fetch.mockResolvedValueOnce(mockResponse)

    const { envoyerMessageOllamaAvecOutils } = await import("../chat-ollama-tools")
    const resultat = await envoyerMessageOllamaAvecOutils(
      "http://localhost:11434",
      "llama2",
      "Tu es un assistant agricole.",
      [{ role: "user", content: "Bonjour" }],
      "user-test"
    )

    expect(resultat).toBe("Je ne supporte pas les outils.")
  })

  it("lève une erreur pour une réponse API invalide", async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    }
    global.fetch.mockResolvedValue(mockResponse)

    const { envoyerMessageOllamaAvecOutils } = await import("../chat-ollama-tools")

    await expect(
      envoyerMessageOllamaAvecOutils(
        "http://localhost:11434",
        "llama3",
        "System",
        [{ role: "user", content: "Test" }],
        undefined
      )
    ).rejects.toThrow("Erreur Ollama")
  })
})
