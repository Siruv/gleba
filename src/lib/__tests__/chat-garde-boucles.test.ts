/**
 * Preuve que les quatre boucles de fournisseurs passent la garde par requête :
 * un faux fournisseur renvoie TOUJOURS le même tool_call d'écriture, le handler
 * d'upstream ne doit s'exécuter qu'une fois et l'erreur finale liste l'écriture.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ handler: vi.fn() }))

vi.mock("@/lib/chat-tools", async () => {
  const { estOutilEcriture } = await import("@/lib/chat/gardeEcritures")
  return {
    outilsChat: [],
    outilsPourBackend: () => [{ type: "function", name: "create_culture" }],
    executerOutil: async (
      nom: string,
      args: string,
      _u: string,
      ctx?: { garde?: { executer: (n: string, a: string, f: () => Promise<string>) => Promise<string> } }
    ) => {
      const exec = async () => JSON.stringify(await mocks.handler(nom, args))
      return ctx?.garde && estOutilEcriture(nom) ? ctx.garde.executer(nom, args, exec) : exec()
    },
  }
})
vi.mock("@/lib/settings", () => ({
  getSetting: async () => "jeton",
  setSetting: async () => undefined,
}))

import { envoyerMessageAvecOutils } from "@/lib/chat-openai-tools"
import { envoyerMessageAnthropicAvecOutils } from "@/lib/chat-anthropic-tools"
import { envoyerMessageOllamaAvecOutils } from "@/lib/chat-ollama-tools"
import { envoyerMessageCodex, parserReponseSSEComplete } from "@/lib/chat-codex"

const json = (donnees: unknown) => ({ ok: true, status: 200, json: async () => donnees })

function verifier(erreur: unknown) {
  expect(mocks.handler).toHaveBeenCalledTimes(1)
  const message = (erreur as Error).message
  expect(message).toContain("Trop d'appels d'outils consécutifs.")
  expect(message).toContain("create_culture")
  expect(message).toContain("Culture créée (id 1)")
}

describe("garde des écritures dans les boucles de fournisseurs", () => {
  beforeEach(() => {
    mocks.handler.mockReset()
    mocks.handler.mockResolvedValue({ message: "Culture créée (id 1)" })
  })

  it("openai", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      json({ choices: [{ message: { content: null, tool_calls: [
        { id: "c", type: "function", function: { name: "create_culture", arguments: '{"a":1}' } },
      ] } }] })))
    await envoyerMessageAvecOutils("http://x", "k", "m", "s", [{ role: "user", content: "x" }], "u1")
      .then(() => expect.unreachable(), verifier)
  })

  it("anthropic", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      json({ content: [{ type: "tool_use", id: "t", name: "create_culture", input: { a: 1 } }] })))
    await envoyerMessageAnthropicAvecOutils("http://x", "k", "m", "s", [{ role: "user", content: "x" }], "u1")
      .then(() => expect.unreachable(), verifier)
  })

  it("ollama", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      json({ message: { role: "assistant", content: "", tool_calls: [
        { function: { name: "create_culture", arguments: { a: 1 } } },
      ] } })))
    await envoyerMessageOllamaAvecOutils("http://x", "m", "s", [{ role: "user", content: "x" }], "u1")
      .then(() => expect.unreachable(), verifier)
  })

  it("codex", async () => {
    const sse = [
      `data: ${JSON.stringify({ type: "response.output_item.done", item: { type: "function_call", name: "create_culture", arguments: '{"a":1}', call_id: "c1" } })}`,
      "",
    ].join("\n")
    expect(parserReponseSSEComplete(sse).functionCalls).toHaveLength(1)
    vi.stubGlobal("fetch", vi.fn(async () => new Response(sse, { status: 200 })))
    await envoyerMessageCodex([{ role: "user", content: "x" }], "m", "s", "u1")
      .then(() => expect.unreachable(), verifier)
  })
})
