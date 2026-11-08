/**
 * Appel EN PROCESSUS des handlers de routes d'upstream (phase 2c, approche A de
 * docs/pluginAssistantAuditOutils.md, section 4).
 *
 * Les outils d'écriture de l'assistant n'écrivent plus en base : ils appellent
 * le handler de la route que l'interface d'upstream utilise, donc toutes ses
 * règles s'appliquent (validation, rotation, occupation, ventes, cache KPI...).
 *
 * Authentification : les handlers appellent `requireAuthApi()` sans argument,
 * donc `auth()` de next-auth lit `headers()` de la requête Next COURANTE (celle
 * de /api/chat, cookie compris), pas la requête construite ici. Le tenant est
 * résolu par upstream. Hors requête (script, tâche de fond), `auth()` rend
 * `null` et le handler répond 401 : ce chemin ne peut pas écrire.
 *
 * Garde lecture seule : l'en-tête de mutation du middleware vaut « 0 » pour
 * /api/chat, donc la garde d'upstream ne se déclenche pas dans ce contexte. Le
 * refus explicite reste porté par `executerOutil` (chat-tools.ts). On ne
 * transmet volontairement AUCUN en-tête de mutation.
 *
 * Aucune pile technique ne remonte : un 500 ou une exception deviennent un
 * message générique.
 */

import { NextRequest } from "next/server"
import { headers } from "next/headers"

export type MethodeRoute = "POST" | "PATCH" | "PUT" | "DELETE"

export interface AppelRoute {
  methode: MethodeRoute
  /** Chemin d'API, ex. `/api/cultures/42` (informatif : le handler est appelé directement). */
  chemin: string
  corps?: unknown
  /** Paramètres dynamiques de la route (`[id]`). */
  params?: Record<string, string>
}

export type ResultatRoute =
  | { ok: true; statut: number; donnees: Record<string, unknown> }
  | { ok: false; statut: number; message: string; avertissement: boolean }

/** Handler de route Next : `(requete)` ou `(requete, { params })`. */
export type HandlerRoute = (requete: NextRequest, contexte: never) => Promise<Response> | Response

const MESSAGE_INTERNE = "Erreur interne : l'opération n'a pas pu aboutir. Rien n'a été modifié de façon certaine, réessayez plus tard."

const MESSAGES_PAR_DEFAUT: Record<number, string> = {
  400: "Les données fournies sont invalides.",
  401: "Session expirée ou absente : reconnectez-vous.",
  403: "Cette action n'est pas autorisée pour votre rôle.",
  404: "Élément introuvable.",
  409: "L'opération est refusée car elle entre en conflit avec des données existantes.",
  422: "Les données fournies ne peuvent pas être traitées.",
  429: "Trop de requêtes, veuillez réessayer plus tard.",
}

/** En-têtes utiles de la requête courante : le cookie de session, l'IP client. */
async function entetesCourants(): Promise<Headers> {
  const sortie = new Headers({ "content-type": "application/json" })
  try {
    const courants = await headers()
    for (const nom of ["cookie", "x-forwarded-for", "x-forwarded-proto", "host"]) {
      const valeur = courants.get(nom)
      if (valeur) sortie.set(nom, valeur)
    }
  } catch {
    // Hors contexte de requête : le handler répondra 401 par lui-même.
  }
  return sortie
}

/** Erreurs de champ d'un `flatten()` zod, en une phrase lisible. */
function detailsValidation(details: unknown): string {
  if (typeof details !== "object" || details === null) return ""
  const { fieldErrors, formErrors } = details as { fieldErrors?: Record<string, unknown>; formErrors?: unknown }
  const morceaux: string[] = []
  if (Array.isArray(formErrors)) morceaux.push(...formErrors.filter((m): m is string => typeof m === "string"))
  if (fieldErrors && typeof fieldErrors === "object") {
    for (const [champ, messages] of Object.entries(fieldErrors)) {
      if (Array.isArray(messages) && messages.length > 0) {
        morceaux.push(`${champ} : ${messages.filter((m) => typeof m === "string").join(", ")}`)
      }
    }
  }
  return morceaux.join(" ; ")
}

/**
 * Message à montrer au modèle pour une réponse d'échec : celui d'upstream
 * (`error`, sinon `warning`), tel quel, sinon un message par défaut du statut.
 */
export function messageDepuisReponse(statut: number, corps: Record<string, unknown>): string {
  const base =
    typeof corps.error === "string" && corps.error.trim() !== ""
      ? corps.error
      : typeof corps.warning === "string" && corps.warning.trim() !== ""
        ? corps.warning
        : (MESSAGES_PAR_DEFAUT[statut] ?? MESSAGE_INTERNE)
  if (statut === 400) {
    const precision = detailsValidation(corps.details)
    if (precision) return `${base} (${precision})`
  }
  return base
}

function refus(statut: number, message: string, avertissement = false): ResultatRoute {
  return { ok: false, statut, message, avertissement }
}

/**
 * Appelle un handler d'upstream et normalise sa réponse.
 *
 * - succès (2xx) : `{ ok: true, statut, donnees }`, JSON de la réponse ;
 * - refus métier (4xx) : `{ ok: false, message }` avec le message d'upstream en
 *   français, tel quel ; un 409 porteur de `warning` est marqué `avertissement`
 *   (rotation « Continuer ? ») et n'est JAMAIS rejoué avec une confirmation ;
 * - 5xx, exception, réponse illisible : message générique, sans détail.
 */
export async function appelerRouteUpstream(handler: HandlerRoute, appel: AppelRoute): Promise<ResultatRoute> {
  try {
    const init: { method: string; headers: Headers; body?: string } = {
      method: appel.methode,
      headers: await entetesCourants(),
    }
    if (appel.corps !== undefined) init.body = JSON.stringify(appel.corps)
    const requete = new NextRequest(new URL(appel.chemin, "http://localhost"), init)
    const contexte = appel.params ? { params: Promise.resolve(appel.params) } : undefined

    const reponse = await (handler as (r: NextRequest, c?: unknown) => Promise<Response> | Response)(requete, contexte)

    let corps: Record<string, unknown> | null = null
    try {
      const texte = await reponse.text()
      if (texte.trim() !== "") {
        const lu: unknown = JSON.parse(texte)
        corps = typeof lu === "object" && lu !== null && !Array.isArray(lu) ? (lu as Record<string, unknown>) : { valeur: lu }
      }
    } catch {
      corps = null
    }

    if (reponse.status >= 200 && reponse.status < 300) {
      return { ok: true, statut: reponse.status, donnees: corps ?? {} }
    }
    if (reponse.status >= 500 || corps === null) {
      return refus(reponse.status >= 400 ? reponse.status : 500, MESSAGE_INTERNE)
    }
    const avertissement =
      reponse.status === 409 && typeof corps.warning === "string" && typeof corps.error !== "string"
    return refus(reponse.status, messageDepuisReponse(reponse.status, corps), avertissement)
  } catch (erreur) {
    // Journal serveur seulement : le modèle ne reçoit jamais le message brut.
    console.error("appelerRouteUpstream :", appel.methode, appel.chemin, erreur)
    return refus(500, MESSAGE_INTERNE)
  }
}
