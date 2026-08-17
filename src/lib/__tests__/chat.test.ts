import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  parametreFindUnique: vi.fn(),
  ollamaChat: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  default: {
    parametre: {
      findUnique: mocks.parametreFindUnique,
    },
  },
}))

vi.mock("ollama", () => ({
  Ollama: class {
    chat = mocks.ollamaChat
  },
}))

import {
  chatActif,
  envoyerMessageChat,
  modeleEffectif,
} from "../chat"
import { clearSettingsCache } from "../settings"

const variablesEnvironnement = [
  "CHAT_PROVIDER",
  "CHAT_MODEL",
  "CHAT_API_KEY",
  "CHAT_BASE_URL",
  "OLLAMA_HOST",
  "OLLAMA_MODEL",
] as const

type ReglagesTest = Record<string, string | undefined>

function configurerReglages(reglages: ReglagesTest): void {
  mocks.parametreFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
    const valeur = reglages[where.id]
    return valeur === undefined ? null : { valeur }
  })
}

describe("service de chat IA", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearSettingsCache()
    for (const cle of variablesEnvironnement) delete process.env[cle]
    configurerReglages({})
    vi.stubGlobal("fetch", vi.fn())
  })

  it("indique que le chat Ollama est inactif si son hôte est vide", async () => {
    configurerReglages({ "chat.ollamaHost": "" })

    await expect(chatActif()).resolves.toBe(false)
  })

  it("indique que le chat Ollama est actif quand son hôte est défini", async () => {
    configurerReglages({ "chat.ollamaHost": "http://ollama:11434" })

    await expect(chatActif()).resolves.toBe(true)
  })

  it("indique que le chat OpenAI est actif avec une clé API", async () => {
    configurerReglages({
      "chat.provider": "openai",
      "chat.apiKey": "clé-de-test-non-réelle",
    })

    await expect(chatActif()).resolves.toBe(true)
  })

  it("indique que ChatGPT est actif quand le token Codex est présent", async () => {
    configurerReglages({
      "chat.provider": "openai-codex",
      "chat.codexAccessToken": "jeton-de-test-non-réel",
    })

    await expect(chatActif()).resolves.toBe(true)
  })

  it("indique que ChatGPT est inactif sans token Codex", async () => {
    configurerReglages({ "chat.provider": "openai-codex" })

    await expect(chatActif()).resolves.toBe(false)
  })

  it("retourne les modèles par défaut de chaque provider", () => {
    expect(modeleEffectif("ollama", "")).toBe("glm-4.7")
    expect(modeleEffectif("openai", "")).toBe("gpt-4o-mini")
    expect(modeleEffectif("anthropic", "")).toBe("claude-sonnet-4-5")
  })

  it("privilégie le modèle configuré et exige un modèle personnalisé", () => {
    expect(modeleEffectif("openai", "mon-modele")).toBe("mon-modele")
    expect(() => modeleEffectif("custom", "")).toThrow(
      "Indiquez le modèle à utiliser pour le provider personnalisé"
    )
  })

  it("envoie un message à OpenAI avec l'URL et l'autorisation configurées", async () => {
    configurerReglages({
      "chat.provider": "openai",
      "chat.apiKey": "clé-de-test-non-réelle",
      "chat.model": "gpt-test",
    })
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "Réponse OpenAI" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )

    await expect(
      envoyerMessageChat([{ role: "user", content: "Bonjour" }], "maraîchage")
    ).resolves.toBe("Réponse OpenAI")

    expect(fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer clé-de-test-non-réelle" }),
      })
    )
  })

  it("envoie un message à Anthropic avec son en-tête API", async () => {
    configurerReglages({
      "chat.provider": "anthropic",
      "chat.apiKey": "clé-anthropic-de-test-non-réelle",
      "chat.model": "claude-test",
    })
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ content: [{ text: "Réponse Anthropic" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )

    await expect(envoyerMessageChat([{ role: "user", content: "Bonjour" }])).resolves.toBe(
      "Réponse Anthropic"
    )

    expect(fetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-api-key": "clé-anthropic-de-test-non-réelle",
        }),
      })
    )
  })

  it("envoie un message à Ollama avec l'hôte configuré", async () => {
    configurerReglages({
      "chat.ollamaHost": "http://ollama:11434",
      "chat.model": "glm-test",
    })
    mocks.ollamaChat.mockResolvedValue({ message: { content: "Réponse Ollama" } })

    await expect(envoyerMessageChat([{ role: "user", content: "Bonjour" }])).resolves.toBe(
      "Réponse Ollama"
    )
    expect(mocks.ollamaChat).toHaveBeenCalled()
  })
})
