import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  parametreFindUnique: vi.fn(),
  parametreUpsert: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  default: {
    parametre: {
      findUnique: mocks.parametreFindUnique,
      upsert: mocks.parametreUpsert,
    },
  },
}))

import {
  demarrerConnexionCodex,
  echangerCodeCodex,
  envoyerMessageCodex,
  sonderConnexionCodex,
} from "../chat-codex"
import { clearSettingsCache } from "../settings"

describe("provider ChatGPT Codex", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearSettingsCache()
    mocks.parametreFindUnique.mockResolvedValue(null)
    mocks.parametreUpsert.mockResolvedValue(undefined)
    vi.stubGlobal("fetch", vi.fn())
  })

  it("démarre une connexion device code et parse la réponse", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ user_code: "ABCD-EFGH", device_auth_id: "device-test", interval: 5 }), {
        status: 200,
      })
    )

    await expect(demarrerConnexionCodex()).resolves.toEqual({
      userCode: "ABCD-EFGH",
      deviceAuthId: "device-test",
      verificationUrl: "https://auth.openai.com/codex/device",
    })
    expect(fetch).toHaveBeenCalledWith(
      "https://auth.openai.com/api/accounts/deviceauth/usercode",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ client_id: "app_EMoamEEZ73f0CkXaXp7hrann" }),
      })
    )
  })

  it("retourne les tokens quand le device code est validé", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ authorization_code: "code-test", code_verifier: "verifier-test" }), {
        status: 200,
      })
    )

    await expect(sonderConnexionCodex("device-test", "ABCD-EFGH")).resolves.toEqual({
      authorizationCode: "code-test",
      codeVerifier: "verifier-test",
    })
  })

  it("retourne null tant que le device code n'est pas validé", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 403 }))

    await expect(sonderConnexionCodex("device-test", "ABCD-EFGH")).resolves.toBeNull()
  })

  it("échange le code d'autorisation avec un body form-urlencoded", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ access_token: "access-test", refresh_token: "refresh-test" }), {
        status: 200,
      })
    )

    await expect(echangerCodeCodex("code-test", "verifier-test")).resolves.toEqual({
      accessToken: "access-test",
      refreshToken: "refresh-test",
    })
    expect(fetch).toHaveBeenCalledWith(
      "https://auth.openai.com/oauth/token",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=authorization_code&code=code-test&redirect_uri=https%3A%2F%2Fauth.openai.com%2Fdeviceauth%2Fcallback&client_id=app_EMoamEEZ73f0CkXaXp7hrann&code_verifier=verifier-test",
      })
    )
  })

  it("envoie un message au backend Codex et extrait le texte de réponse", async () => {
    mocks.parametreFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === "chat.codexAccessToken") return { valeur: "access-test" }
      if (where.id === "chat.codexRefreshToken") return { valeur: "refresh-test" }
      return null
    })
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            { type: "message", content: [{ type: "output_text", text: "Réponse ChatGPT" }] },
          ],
        }),
        { status: 200 }
      )
    )

    await expect(
      envoyerMessageCodex(
        [
          { role: "user", content: "Bonjour" },
          { role: "assistant", content: "Bonjour !" },
        ],
        "gpt-test",
        "Réponds en français."
      )
    ).resolves.toBe("Réponse ChatGPT")

    expect(fetch).toHaveBeenCalledWith(
      "https://chatgpt.com/backend-api/codex/responses",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-test",
        },
      })
    )
    const options = vi.mocked(fetch).mock.calls[0]?.[1]
    const body = JSON.parse(String(options?.body)) as { input: Array<{ content: Array<{ type: string }> }> }
    expect(body.input[0]?.content[0]?.type).toBe("input_text")
    expect(body.input[1]?.content[0]?.type).toBe("output_text")
  })
})
