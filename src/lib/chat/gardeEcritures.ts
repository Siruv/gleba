/**
 * Garde des écritures de l'assistant, PAR REQUÊTE de chat.
 *
 * Problème : avec un fournisseur en cascade (plusieurs modèles qui se relaient
 * à chaque tour de la boucle d'outils), un modèle peut rappeler un outil
 * d'écriture déjà exécuté au lieu de conclure, et dupliquer des données.
 *
 * Cet état est créé dans `envoyerMessageChat` et transmis aux boucles : il ne
 * vit JAMAIS dans une variable de module ni dans un cache global, donc deux
 * requêtes simultanées (comptes différents) ne se voient pas.
 *
 * Elle ne remplace PAS la confirmation avant écriture (phase 5 du plugin
 * assistant) : elle borne seulement les dégâts d'une boucle de modèle.
 */

/**
 * Nombre maximal d'écritures distinctes (nom + arguments différents) acceptées
 * pour une même requête de chat. Au-delà, les outils d'écriture n'exécutent
 * rien et demandent à l'utilisateur de confirmer ce qui reste à faire.
 */
export const PLAFOND_ECRITURES_PAR_REQUETE = 5

export const CONSIGNE_ECRITURE_REPETEE =
  "Cette opération a déjà été exécutée, ne la répète pas, conclus maintenant pour l'utilisateur."

export const MESSAGE_PLAFOND_ECRITURES =
  "Limite d'opérations atteinte pour cette demande, confirmez ce qui reste à faire."

type EcritureRealisee = { outil: string; resume: string }

export type GardeEcritures = {
  /** Écritures réussies, dans l'ordre d'exécution. */
  readonly realisees: EcritureRealisee[]
  /** Appelé pour chaque appel d'écriture ; `executer` n'est lancé qu'une fois par appel distinct. */
  executer(nom: string, argsJson: string, executer: () => Promise<string>): Promise<string>
}

/** Les outils de lecture sont préfixés `get_` ; tout le reste écrit. */
export function estOutilEcriture(nom: string): boolean {
  return !nom.startsWith("get_")
}

function normaliser(valeur: unknown): unknown {
  if (Array.isArray(valeur)) return valeur.map(normaliser)
  if (valeur !== null && typeof valeur === "object") {
    const objet = valeur as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(objet)
        .sort()
        .map((cle) => [cle, normaliser(objet[cle])])
    )
  }
  return valeur
}

/** JSON stable : l'ordre des clés ne change pas l'identité d'un appel. */
export function cleAppel(nom: string, argsJson: string): string {
  let args: unknown
  try {
    args = argsJson ? JSON.parse(argsJson) : {}
  } catch {
    args = argsJson
  }
  return `${nom}:${JSON.stringify(normaliser(args))}`
}

function estEchec(resultat: string): boolean {
  try {
    const donnees: unknown = JSON.parse(resultat)
    return donnees !== null && typeof donnees === "object" && "erreur" in donnees
  } catch {
    return false
  }
}

function resumer(resultat: string): string {
  try {
    const donnees: unknown = JSON.parse(resultat)
    if (donnees !== null && typeof donnees === "object") {
      const message = (donnees as Record<string, unknown>).message
      if (typeof message === "string") return message.slice(0, 160)
    }
  } catch {
    // résultat non JSON : repli sur le texte brut
  }
  return resultat.slice(0, 160)
}

function avecConsigne(resultat: string): string {
  let donnees: unknown
  try {
    donnees = JSON.parse(resultat)
  } catch {
    donnees = { resultat }
  }
  const base =
    donnees !== null && typeof donnees === "object" && !Array.isArray(donnees)
      ? (donnees as Record<string, unknown>)
      : { resultat: donnees }
  return JSON.stringify({ ...base, consigne: CONSIGNE_ECRITURE_REPETEE })
}

export function creerGardeEcritures(plafond: number = PLAFOND_ECRITURES_PAR_REQUETE): GardeEcritures {
  const vues = new Map<string, Promise<string>>()
  const realisees: EcritureRealisee[] = []

  return {
    realisees,
    async executer(nom, argsJson, executer) {
      const cle = cleAppel(nom, argsJson)
      const precedent = vues.get(cle)
      if (precedent) return avecConsigne(await precedent)

      if (vues.size >= plafond) {
        return JSON.stringify({ erreur: MESSAGE_PLAFOND_ECRITURES })
      }

      // Enregistré AVANT l'await : deux appels identiques lancés en parallèle ne s'exécutent qu'une fois.
      const execution = executer()
      vues.set(cle, execution)
      let resultat: string
      try {
        resultat = await execution
      } catch (erreur) {
        vues.delete(cle)
        throw erreur
      }
      if (estEchec(resultat)) {
        // Une écriture refusée ou échouée n'a rien écrit : elle ne consomme pas le plafond et peut être retentée.
        vues.delete(cle)
      } else {
        realisees.push({ outil: nom, resume: resumer(resultat) })
      }
      return resultat
    },
  }
}

/** Message final quand la boucle atteint son plafond d'itérations. */
export function messageTropAppels(garde?: GardeEcritures): string {
  const base = "Trop d'appels d'outils consécutifs."
  if (!garde || garde.realisees.length === 0) return base
  const liste = garde.realisees.map((e) => `${e.outil} (${e.resume})`).join(" ; ")
  return `${base} Opérations déjà réalisées pour cette demande, à vérifier : ${liste}.`
}
