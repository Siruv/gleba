import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  requireAdminApi: vi.fn(),
  sonderConnexionCodex: vi.fn(),
  echangerCodeCodex: vi.fn(),
  setSetting: vi.fn(),
}))

vi.mock("@/lib/auth-utils", () => ({ requireAdminApi: mocks.requireAdminApi }))
vi.mock("@/lib/chat-codex", () => ({
  sonderConnexionCodex: mocks.sonderConnexionCodex,
  echangerCodeCodex: mocks.echangerCodeCodex,
}))
vi.mock("@/lib/settings", () => ({ setSetting: mocks.setSetting }))

import { POST } from "./route"

describe("POST /api/admin/chat/codex-login/poll", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdminApi.mockResolvedValue({ error: null, session: { user: { role: "ADMIN" } } })
    mocks.sonderConnexionCodex.mockResolvedValue({
      authorizationCode: "code-autorisation-test",
      codeVerifier: "verifieur-test",
    })
    mocks.echangerCodeCodex.mockResolvedValue({
      accessToken: "jeton-acces-test",
      refreshToken: "jeton-actualisation-test",
    })
    mocks.setSetting.mockResolvedValue("")
  })

  it("active le provider Codex après l'échange des tokens", async () => {
    const response = await POST(new NextRequest(
      "http://localhost/api/admin/chat/codex-login/poll",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceAuthId: "device-test", userCode: "code-test" }),
      },
    ))

    expect(response.status).toBe(200)
    expect(mocks.setSetting).toHaveBeenCalledTimes(3)
    expect(mocks.setSetting).toHaveBeenCalledWith("chat.provider", "openai-codex")
  })
})
