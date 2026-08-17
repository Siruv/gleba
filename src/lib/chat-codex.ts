const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const CODEX_ISSUER = "https://auth.openai.com"
const CODEX_DEVICE_CODE_URL = `${CODEX_ISSUER}/api/accounts/deviceauth/usercode`
const CODEX_DEVICE_TOKEN_URL = `${CODEX_ISSUER}/api/accounts/deviceauth/token`
const CODEX_OAUTH_TOKEN_URL = `${CODEX_ISSUER}/oauth/token`
const CODEX_REDIRECT_URI = `${CODEX_ISSUER}/deviceauth/callback`
const CODEX_VERIFICATION_URL = `${CODEX_ISSUER}/codex/device`
const CODEX_API_BASE = "https://chatgpt.com/backend-api/codex"
const CODEX_MODEL_DEFAUT = "gpt-4o-mini"

type ReponseJson = Record<string, unknown>
type MessageCodex = { role: string; content: string }

type TokensCodex = {
  accessToken: string
  refreshToken: string
}

async function lireReponseJson(response: Response, messageErreur: string): Promise<ReponseJson> {
  if (!response.ok) throw new Error(messageErreur)

  const data: unknown = await response.json().catch(() => null)
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Réponse invalide du backend ChatGPT.")
  }
  return data as ReponseJson
}

function lireChaine(data: ReponseJson, cle: string): string | null {
  const valeur = data[cle]
  return typeof valeur === "string" && valeur !== "" ? valeur : null
}

export async function demarrerConnexionCodex(): Promise<{
  userCode: string
  deviceAuthId: string
  verificationUrl: string
}> {
  const response = await fetch(CODEX_DEVICE_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
  })
  const data = await lireReponseJson(
    response,
    `Impossible de démarrer la connexion à ChatGPT (HTTP ${response.status}).`
  )
  const userCode = lireChaine(data, "user_code")
  const deviceAuthId = lireChaine(data, "device_auth_id")
  if (!userCode || !deviceAuthId) {
    throw new Error("Réponse invalide du backend ChatGPT.")
  }

  return { userCode, deviceAuthId, verificationUrl: CODEX_VERIFICATION_URL }
}

export async function sonderConnexionCodex(
  deviceAuthId: string,
  userCode: string
): Promise<{ authorizationCode: string; codeVerifier: string } | null> {
  const response = await fetch(CODEX_DEVICE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
  })
  if (response.status === 403 || response.status === 404) return null

  const data = await lireReponseJson(
    response,
    `Impossible de vérifier la connexion à ChatGPT (HTTP ${response.status}).`
  )
  const authorizationCode = lireChaine(data, "authorization_code")
  const codeVerifier = lireChaine(data, "code_verifier")
  if (!authorizationCode || !codeVerifier) {
    throw new Error("Réponse invalide du backend ChatGPT.")
  }
  return { authorizationCode, codeVerifier }
}

export async function echangerCodeCodex(
  authorizationCode: string,
  codeVerifier: string
): Promise<TokensCodex> {
  const parametres = new URLSearchParams({
    grant_type: "authorization_code",
    code: authorizationCode,
    redirect_uri: CODEX_REDIRECT_URI,
    client_id: CODEX_CLIENT_ID,
    code_verifier: codeVerifier,
  })
  const response = await fetch(CODEX_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: parametres.toString(),
  })
  const data = await lireReponseJson(
    response,
    `Impossible de finaliser la connexion à ChatGPT (HTTP ${response.status}).`
  )
  const accessToken = lireChaine(data, "access_token")
  const refreshToken = lireChaine(data, "refresh_token")
  if (!accessToken || !refreshToken) {
    throw new Error("Réponse invalide du backend ChatGPT.")
  }
  return { accessToken, refreshToken }
}

export async function rafraichirTokenCodex(refreshToken: string): Promise<TokensCodex> {
  const messageErreur = "Le refresh token a expiré. Reconnectez-vous à ChatGPT."
  try {
    const parametres = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CODEX_CLIENT_ID,
      refresh_token: refreshToken,
    })
    const response = await fetch(CODEX_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: parametres.toString(),
    })
    if (!response.ok) throw new Error(messageErreur)

    const data: unknown = await response.json().catch(() => null)
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new Error(messageErreur)
    }
    const accessToken = lireChaine(data as ReponseJson, "access_token")
    const nouveauRefreshToken = lireChaine(data as ReponseJson, "refresh_token")
    if (!accessToken || !nouveauRefreshToken) throw new Error(messageErreur)
    return { accessToken, refreshToken: nouveauRefreshToken }
  } catch {
    throw new Error(messageErreur)
  }
}

async function appelerBackendCodex(
  accessToken: string,
  messages: MessageCodex[],
  model: string,
  systeme: string
): Promise<Response> {
  return fetch(`${CODEX_API_BASE}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      model: model.trim() || CODEX_MODEL_DEFAUT,
      instructions: systeme,
      input: messages.map((message) => ({
        role: message.role,
        content: [{
          type: message.role === "assistant" ? "output_text" : "input_text",
          text: message.content,
        }],
      })),
    }),
    signal: AbortSignal.timeout(60_000),
  })
}

function extraireTexteCodex(data: unknown): string {
  if (typeof data !== "object" || data === null || !Array.isArray((data as ReponseJson).output)) {
    throw new Error("Réponse invalide du backend ChatGPT.")
  }

  const output = (data as ReponseJson).output as unknown[]
  for (const item of output) {
    if (typeof item !== "object" || item === null) continue
    const contenu = (item as ReponseJson).content
    if ((item as ReponseJson).type !== "message" || !Array.isArray(contenu)) continue
    for (const element of contenu) {
      if (typeof element !== "object" || element === null) continue
      if (
        (element as ReponseJson).type === "output_text" &&
        typeof (element as ReponseJson).text === "string"
      ) {
        return (element as ReponseJson).text as string
      }
    }
  }
  throw new Error("Réponse invalide du backend ChatGPT.")
}

export async function envoyerMessageCodex(
  messages: MessageCodex[],
  model: string,
  systeme: string
): Promise<string> {
  const { getSetting, setSetting } = await import("@/lib/settings")
  let accessToken = (await getSetting("chat.codexAccessToken")).trim()
  if (accessToken === "") throw new Error("Non connecté à ChatGPT.")

  let response = await appelerBackendCodex(accessToken, messages, model, systeme)
  if (response.status === 401) {
    const refreshToken = (await getSetting("chat.codexRefreshToken")).trim()
    const tokens = await rafraichirTokenCodex(refreshToken)
    accessToken = tokens.accessToken
    await setSetting("chat.codexAccessToken", tokens.accessToken)
    await setSetting("chat.codexRefreshToken", tokens.refreshToken)
    response = await appelerBackendCodex(accessToken, messages, model, systeme)
  }

  const data = await lireReponseJson(
    response,
    `Erreur API ChatGPT (HTTP ${response.status}).`
  )
  return extraireTexteCodex(data)
}
