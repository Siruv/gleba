import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mocks = vi.hoisted(() => ({
  requireAdminApi: vi.fn(),
  getSetting: vi.fn(),
}))

vi.mock("@/lib/auth-utils", () => ({ requireAdminApi: mocks.requireAdminApi }))
vi.mock("@/lib/settings", () => ({ getSetting: mocks.getSetting }))

import { GET } from "../models/route"

afterEach(() => {
  vi.restoreAllMocks()
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdminApi.mockResolvedValue({ error: null })
})

describe("/api/admin/chat/models", () => {
  it("should return 400 for unsupported provider", async () => {
    const request = new Request("http://localhost/api/admin/chat/models?provider=unsupported")
    const response = await GET(request)
    
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain("Provider non supporté")
  })

  it("should filter out embedding/tts models for openai", async () => {
    // Mock fetch to return OpenAI-like response
    const mockModels = {
      data: [
        { id: "gpt-4o" },
        { id: "gpt-4o-mini" },
        { id: "text-embedding-ada-002" },
        { id: "tts-1" },
        { id: "whisper-1" },
        { id: "dall-e-3" }
      ]
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockModels),
      status: 200
    }) as unknown as typeof fetch

    // Mock getSetting
    mocks.getSetting.mockImplementation((key: string) => {
      if (key === "chat.apiKey") return Promise.resolve("test-key")
      if (key === "chat.baseUrl") return Promise.resolve("https://api.openai.com/v1")
      return Promise.resolve("")
    })

    const request = new Request("http://localhost/api/admin/chat/models?provider=openai")
    const response = await GET(request)
    
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.modeles).toBeDefined()
    expect(Array.isArray(data.modeles)).toBe(true)
    
    // Should only include gpt models, not embedding/tts/whisper/dall-e
    const modelIds = data.modeles.map((m: { id: string }) => m.id)
    expect(modelIds).toContain("gpt-4o")
    expect(modelIds).toContain("gpt-4o-mini")
    expect(modelIds).not.toContain("text-embedding-ada-002")
    expect(modelIds).not.toContain("tts-1")
    expect(modelIds).not.toContain("whisper-1")
    expect(modelIds).not.toContain("dall-e-3")
    
    // All OpenAI models should have functionCalling=true
    expect(data.modeles.every((m: { functionCalling: boolean }) => m.functionCalling === true)).toBe(true)
  })

  it("should return 400 when API key is missing for non-ollama provider", async () => {
    // Mock getSetting to return empty API key
    mocks.getSetting.mockResolvedValue("")

    const request = new Request("http://localhost/api/admin/chat/models?provider=openai")
    const response = await GET(request)
    
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain("Renseignez la clé API d'abord")
  })

  it("should return 400 when baseUrl is missing for custom provider", async () => {
    // Mock getSetting
    mocks.getSetting.mockImplementation((key: string) => {
      if (key === "chat.apiKey") return Promise.resolve("test-key")
      if (key === "chat.baseUrl") return Promise.resolve("")
      return Promise.resolve("")
    })

    const request = new Request("http://localhost/api/admin/chat/models?provider=custom")
    const response = await GET(request)
    
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain("Renseignez l'URL de base d'abord")
  })

  it("should handle ollama models correctly", async () => {
    const mockOllamaResponse = {
      models: [
        { name: "llama3" },
        { name: "mistral" },
        { name: "" } // empty name should be filtered out
      ]
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockOllamaResponse),
      status: 200
    }) as unknown as typeof fetch

    // Mock getSetting for ollama host
    mocks.getSetting.mockImplementation((key: string) => {
      if (key === "chat.ollamaHost") return Promise.resolve("http://localhost:11434")
      return Promise.resolve("")
    })

    const request = new Request("http://localhost/api/admin/chat/models?provider=ollama")
    const response = await GET(request)
    
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.modeles).toBeDefined()
    expect(Array.isArray(data.modeles)).toBe(true)
    expect(data.modeles.length).toBe(2) // empty name filtered out
    
    // Ollama models should have functionCalling=false
    expect(data.modeles.every((m: { functionCalling: boolean }) => m.functionCalling === false)).toBe(true)
  })
})
