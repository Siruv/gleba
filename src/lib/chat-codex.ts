const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const CODEX_ISSUER = "https://auth.openai.com"
const CODEX_DEVICE_CODE_URL = `${CODEX_ISSUER}/api/accounts/deviceauth/usercode`
const CODEX_DEVICE_TOKEN_URL = `${CODEX_ISSUER}/api/accounts/deviceauth/token`
const CODEX_OAUTH_TOKEN_URL = `${CODEX_ISSUER}/oauth/token`
const CODEX_REDIRECT_URI = `${CODEX_ISSUER}/deviceauth/callback`
const CODEX_VERIFICATION_URL = `${CODEX_ISSUER}/codex/device`
const CODEX_API_BASE = "https://chatgpt.com/backend-api/codex"
const CODEX_MODELS_URL = `${CODEX_API_BASE}/models`
const CODEX_CLIENT_VERSION = "0.250.0"
const CODEX_MODEL_DEFAUT = "gpt-5.6-luna"

export type ModeleCodex = {
  slug: string
  displayName: string
  description: string
}

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

export async function listerModelesCodex(accessToken: string): Promise<ModeleCodex[]> {
  const response = await fetch(`${CODEX_MODELS_URL}?client_version=${CODEX_CLIENT_VERSION}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    throw new Error(`Impossible de récupérer les modèles ChatGPT (HTTP ${response.status}).`)
  }

  const data: unknown = await response.json()
  if (typeof data !== "object" || data === null || Array.isArray(data) || !("models" in data)) {
    return []
  }

  const modeles = data.models
  if (!Array.isArray(modeles)) return []

  return modeles.flatMap((modele): ModeleCodex[] => {
    if (typeof modele !== "object" || modele === null || Array.isArray(modele)) return []
    const donnees = modele as ReponseJson
    const slug = typeof donnees.slug === "string" ? donnees.slug : ""
    if (donnees.visibility !== "list" || slug.trim() === "") return []
    const displayName = typeof donnees.display_name === "string" && donnees.display_name !== ""
      ? donnees.display_name
      : slug
    const description = typeof donnees.description === "string" ? donnees.description : ""
    return [{ slug, displayName, description }]
  })
}

export async function appelerBackendCodex(
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
      store: false,
      stream: true,
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

export function parserReponseSSE(corpsTexte: string): string {
  let texte = ""

  for (const ligne of corpsTexte.split(/\r?\n/)) {
    if (!ligne.startsWith("data: ")) continue

    const evenement: unknown = JSON.parse(ligne.slice("data: ".length))
    if (typeof evenement !== "object" || evenement === null) continue

    const donnees = evenement as ReponseJson
    if (donnees.type === "response.output_text.delta" && typeof donnees.delta === "string") {
      texte += donnees.delta
      continue
    }

    if (donnees.type === "error") {
      const erreur = donnees.error
      const message =
        typeof erreur === "object" && erreur !== null && typeof (erreur as ReponseJson).message === "string"
          ? (erreur as ReponseJson).message as string
          : "Erreur du backend ChatGPT."
      throw new Error(message)
    }
  }

  if (texte === "") throw new Error("Réponse vide du backend ChatGPT.")
  return texte
}

export async function envoyerMessageCodex(
  messages: MessageCodex[],
  model: string,
  systeme: string
): Promise<string> {
  const { getSetting, setSetting } = await import("@/lib/settings")
  let accessToken = (await getSetting("chat.codexAccessToken")).trim()
  if (accessToken === "") throw new Error("Non connecté à ChatGPT.")

  let aRafraichiToken = false
  let aReessayeErreurServeur = false

  while (true) {
    let response = await appelerBackendCodex(accessToken, messages, model, systeme)
    if (response.status === 401 && !aRafraichiToken) {
      const refreshToken = (await getSetting("chat.codexRefreshToken")).trim()
      const tokens = await rafraichirTokenCodex(refreshToken)
      accessToken = tokens.accessToken
      await setSetting("chat.codexAccessToken", tokens.accessToken)
      await setSetting("chat.codexRefreshToken", tokens.refreshToken)
      aRafraichiToken = true
      response = await appelerBackendCodex(accessToken, messages, model, systeme)
    }

    if (response.status !== 200) {
      const detail = await response.text()
      throw new Error(`Erreur API ChatGPT (HTTP ${response.status}) : ${detail}`)
    }

    try {
      return parserReponseSSE(await response.text())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const estErreurServeur = message.includes("server_error") || message.includes("error occurred")
      if (aReessayeErreurServeur || !estErreurServeur) throw error
      aReessayeErreurServeur = true
    }
  }
}
