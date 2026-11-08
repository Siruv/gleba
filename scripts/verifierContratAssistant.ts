#!/usr/bin/env tsx
/**
 * Vérificateur du contrat noyau upstream / plugin assistant.
 *
 * Version     : 1.0.0 (2026-11-08)
 * Contrat     : docs/pluginAssistantContrat.md (section a, points d'ancrage)
 *
 * Compare l'état d'upstream AVANT merge (lu par `git show <base>:<chemin>`) et
 * l'arbre de travail (APRÈS merge). Lecture seule : aucun fichier écrit, aucune
 * commande git qui modifie le dépôt, aucun appel réseau.
 *
 * Usage :
 *   npx tsx scripts/verifierContratAssistant.ts --base origin/main
 *   npm run verifier:contratAssistant -- --base origin/main
 *
 * Options :
 *   --base <ref>     référence git d'upstream (défaut : origin/main)
 *   --arbre <dossier> arbre de travail à contrôler (défaut : racine du dépôt) ;
 *                    sert à simuler une cassure sur une copie, sans toucher aux
 *                    fichiers suivis
 *   --strict         les avertissements deviennent des échecs
 *   --aide           affiche cette aide
 *
 * Code retour : 0 si aucun ECHEC, 1 sinon (ou 2 pour une erreur d'usage).
 */

import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Statut = "OK" | "ECHEC" | "AVERTISSEMENT"

export interface Resultat {
  id: string
  libelle: string
  statut: Statut
  details: string[]
}

interface Contexte {
  base: string
  racine: string
  arbre: string
  lireBase: (chemin: string) => string | null
  lireArbre: (chemin: string) => string | null
}

export interface PropsInterface {
  requises: Set<string>
  optionnelles: Set<string>
}

// ---------------------------------------------------------------------------
// Constantes du contrat
// ---------------------------------------------------------------------------

const CHEMIN_STUB_PANEL = "src/components/chat/ChatPanel.tsx"
const CHEMIN_STUB_BULLE = "src/components/chat/ChatBubble.tsx"
const CHEMIN_EVENEMENTS = "src/lib/accueil/evenements.ts"
const CHEMIN_CSS = "src/app/globals.css"
const CHEMIN_LAYOUT = "src/app/layout.tsx"
const CHEMIN_PREFS_BRIEFING = "src/lib/briefing-prefs.ts"
const CHEMIN_DAILY_OPENING = "src/lib/chat/daily-opening.ts"

const LABELS_CSS = ["Assistant IA", "Fermer l'assistant"] as const
const VARIABLES_CSS = ["--app-header-h", "--app-header-visible-h", "--navigation-basse-h"] as const
const VALEUR_EVENEMENT = "gleba:ouvrir-assistant"

/** Préfixes d'import qui visent les zones privées d'upstream (.gitignore). */
const MOTIF_IMPORT_PRIVE =
  /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'](@\/lib\/chat\/[^"']+|@\/lib\/chat|@\/lib\/ollama|@\/hooks\/use-chat)["']/g

const ROUTES_PLUGIN: Array<{ fichier: string; methodes: string[] }> = [
  { fichier: "src/app/api/chat/route.ts", methodes: ["POST"] },
  { fichier: "src/app/api/chat/status/route.ts", methodes: ["GET"] },
  { fichier: "src/app/api/chat/test/route.ts", methodes: ["POST"] },
  { fichier: "src/app/api/mcp/route.ts", methodes: ["POST"] },
  { fichier: "src/app/api/user/api-token/route.ts", methodes: ["GET", "POST", "DELETE"] },
  { fichier: "src/app/api/admin/chat/models/route.ts", methodes: ["GET"] },
  { fichier: "src/app/api/admin/chat/codex-login/route.ts", methodes: ["POST"] },
  { fichier: "src/app/api/admin/chat/codex-login/poll/route.ts", methodes: ["POST"] },
  { fichier: "src/app/api/admin/chat/codex-logout/route.ts", methodes: ["POST"] },
  { fichier: "src/app/api/admin/chat/codex-models/route.ts", methodes: ["GET"] },
  { fichier: "src/app/api/admin/chat/mistral-models/route.ts", methodes: ["GET"] },
]

const PAGES_PLUGIN = ["src/app/admin/chat/page.tsx"]

const CLES_REGLAGES = [
  "chat.provider",
  "chat.model",
  "chat.apiKey",
  "chat.baseUrl",
  "chat.ollamaHost",
  "chat.codexAccessToken",
  "chat.codexRefreshToken",
]

const ZONES_GITIGNORE = [
  "/src/components/chat/*",
  "!/src/components/chat/ChatPanel.tsx",
  "!/src/components/chat/ChatBubble.tsx",
  "/src/lib/chat/",
  "/src/lib/ollama.ts",
  "/src/app/api/chat/",
  "/src/app/api/mcp/",
  "/src/hooks/use-chat.ts",
  "/mcp-server/",
]

const DEPENDANCES_REQUISES = ["react-markdown", "remark-gfm"]
const EXCLUSIONS_TSCONFIG = ["mcp-server", "src/**/__tests__/**"]
const EXPORTS_PREFS_BRIEFING = ["CLE_PREF_BRIEFING_AUTO", "BRIEFING_AUTO_PAR_DEFAUT", "briefingAutoActive"]

// ---------------------------------------------------------------------------
// Fonctions pures (testées dans src/lib/__tests__/verifierContratAssistant.test.ts)
// ---------------------------------------------------------------------------

/** Retire les commentaires bloc et ligne (approximation suffisante pour du TS de composants). */
export function retirerCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
}

/** Lit les propriétés d'une `interface Nom { ... }` (requises / optionnelles). */
export function extraireInterfaceProps(source: string, nomInterface: string): PropsInterface | null {
  const nette = retirerCommentaires(source)
  const debut = nette.search(new RegExp(`interface\\s+${nomInterface}\\s*\\{`))
  if (debut < 0) return null
  const ouverture = nette.indexOf("{", debut)
  let profondeur = 0
  let fin = -1
  for (let i = ouverture; i < nette.length; i++) {
    if (nette[i] === "{") profondeur++
    if (nette[i] === "}") {
      profondeur--
      if (profondeur === 0) {
        fin = i
        break
      }
    }
  }
  if (fin < 0) return null
  const corps = nette.slice(ouverture + 1, fin)
  const resultat: PropsInterface = { requises: new Set(), optionnelles: new Set() }
  for (const ligne of corps.split("\n")) {
    const m = /^\s*(?:readonly\s+)?([A-Za-z_]\w*)(\?)?\s*:/.exec(ligne)
    if (!m) continue
    if (m[2]) resultat.optionnelles.add(m[1])
    else resultat.requises.add(m[1])
  }
  return resultat
}

/**
 * Pour chaque occurrence de `<Composant ... />`, rend les noms d'attributs de
 * premier niveau. Un attribut `{...x}` est rendu sous la forme `...spread`.
 */
export function extraireProprietesJsx(source: string, composant: string): string[][] {
  const occurrences: string[][] = []
  const motif = new RegExp(`<${composant}(?=[\\s/>])`, "g")
  let correspondance: RegExpExecArray | null
  while ((correspondance = motif.exec(source)) !== null) {
    const props: string[] = []
    let i = correspondance.index + correspondance[0].length
    let profondeur = 0
    while (i < source.length) {
      const c = source[i]
      if (c === '"' || c === "'" || c === "`") {
        const guillemet = c
        i++
        while (i < source.length && source[i] !== guillemet) {
          if (source[i] === "\\") i++
          i++
        }
        i++
        continue
      }
      if (c === "{") {
        if (profondeur === 0 && source.startsWith("...", i + 1)) props.push("...spread")
        profondeur++
        i++
        continue
      }
      if (c === "}") {
        profondeur--
        i++
        continue
      }
      if (profondeur === 0) {
        if (c === ">") break
        if (/[A-Za-z_]/.test(c) && /[\s]/.test(source[i - 1] ?? " ")) {
          const m = /^[A-Za-z_][\w-]*/.exec(source.slice(i))
          if (m) {
            props.push(m[0])
            i += m[0].length
            continue
          }
        }
      }
      i++
    }
    occurrences.push(props)
  }
  return occurrences
}

/** Spécificateurs `@/lib/chat/*`, `@/lib/chat`, `@/lib/ollama`, `@/hooks/use-chat` réellement importés. */
export function extraireImportsPrives(source: string): string[] {
  const trouves: string[] = []
  const motif = new RegExp(MOTIF_IMPORT_PRIVE.source, "g")
  let m: RegExpExecArray | null
  while ((m = motif.exec(source)) !== null) trouves.push(m[1])
  return trouves
}

/** Résout un spécificateur `@/...` vers un fichier existant, ou null. */
export function resoudreModule(specifieur: string, existe: (chemin: string) => boolean): string | null {
  const base = `src/${specifieur.slice(2)}`
  const candidats = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`, base]
  for (const candidat of candidats) {
    if (/\.(ts|tsx)$/.test(candidat) && existe(candidat)) return candidat
  }
  return null
}

/** Valeur d'une constante texte exportée : `export const NOM = "valeur"`. */
export function extraireConstanteTexte(source: string, nom: string): string | null {
  const m = new RegExp(`export\\s+const\\s+${nom}\\s*(?::\\s*[\\w<>]+\\s*)?=\\s*["'\`]([^"'\`]*)["'\`]`).exec(source)
  return m ? m[1] : null
}

/** Méthodes HTTP exportées par une route Next.js. */
export function extraireMethodesHttp(source: string): string[] {
  const methodes: string[] = []
  const motif = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g
  let m: RegExpExecArray | null
  while ((m = motif.exec(source)) !== null) methodes.push(m[1])
  return methodes
}

// ---------------------------------------------------------------------------
// Accès aux sources
// ---------------------------------------------------------------------------

function git(racine: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: racine,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  })
}

function listerFichiersArbre(dossier: string, relatif = ""): string[] {
  const resultat: string[] = []
  const complet = path.join(dossier, relatif)
  if (!existsSync(complet)) return resultat
  for (const entree of readdirSync(complet)) {
    if (entree === "node_modules" || entree === ".next") continue
    const sousChemin = relatif === "" ? entree : `${relatif}/${entree}`
    const stat = statSync(path.join(dossier, sousChemin))
    if (stat.isDirectory()) resultat.push(...listerFichiersArbre(dossier, sousChemin))
    else if (/\.(ts|tsx)$/.test(entree)) resultat.push(sousChemin)
  }
  return resultat
}

function construireContexte(base: string, arbre: string, racine: string): Contexte {
  return {
    base,
    racine,
    arbre,
    lireBase: (chemin) => {
      try {
        return git(racine, ["show", `${base}:${chemin}`])
      } catch {
        return null
      }
    },
    lireArbre: (chemin) => {
      const complet = path.join(arbre, chemin)
      return existsSync(complet) ? readFileSync(complet, "utf8") : null
    },
  }
}

function resultat(id: string, libelle: string, details: string[], avertissements: string[] = []): Resultat {
  if (details.length > 0) return { id, libelle, statut: "ECHEC", details }
  if (avertissements.length > 0) return { id, libelle, statut: "AVERTISSEMENT", details: avertissements }
  return { id, libelle, statut: "OK", details: [] }
}

// ---------------------------------------------------------------------------
// Contrôles
// ---------------------------------------------------------------------------

function controlerPropsChatPanel(ctx: Contexte): Resultat {
  const echecs: string[] = []
  const sourceBase = ctx.lireBase(CHEMIN_STUB_PANEL)
  const sourceNotre = ctx.lireArbre(CHEMIN_STUB_PANEL)
  if (!sourceBase) return resultat("C02", "Props de ChatPanel : stub upstream vs notre composant", [`${CHEMIN_STUB_PANEL} absent de ${ctx.base}`])
  if (!sourceNotre) return resultat("C02", "Props de ChatPanel : stub upstream vs notre composant", [`${CHEMIN_STUB_PANEL} absent de l'arbre de travail`])
  const upstream = extraireInterfaceProps(sourceBase, "ChatPanelProps")
  const notre = extraireInterfaceProps(sourceNotre, "ChatPanelProps")
  if (!upstream) echecs.push("interface ChatPanelProps introuvable dans le stub upstream")
  if (!notre) echecs.push("interface ChatPanelProps introuvable dans notre ChatPanel")
  if (upstream && notre) {
    const toutesNotre = new Set([...notre.requises, ...notre.optionnelles])
    for (const prop of upstream.requises) {
      if (!toutesNotre.has(prop)) echecs.push(`prop requise par upstream absente chez nous : ${prop}`)
    }
    for (const prop of upstream.optionnelles) {
      if (!toutesNotre.has(prop)) echecs.push(`prop optionnelle d'upstream absente chez nous : ${prop}`)
      if (notre.requises.has(prop)) echecs.push(`prop optionnelle chez upstream mais requise chez nous : ${prop}`)
    }
    const toutesUpstream = new Set([...upstream.requises, ...upstream.optionnelles])
    for (const prop of notre.requises) {
      if (!upstream.requises.has(prop)) echecs.push(`prop requise chez nous mais inconnue ou facultative chez upstream : ${prop}`)
    }
    // Les props ajoutées par le plugin doivent rester facultatives.
    for (const prop of notre.requises) {
      if (!toutesUpstream.has(prop)) echecs.push(`ajout non facultatif du plugin : ${prop}`)
    }
  }
  if (!/export\s+function\s+ChatPanel\s*\(/.test(sourceNotre)) echecs.push("export function ChatPanel absent de notre composant")
  return resultat("C02", "Props de ChatPanel : stub upstream vs notre composant", echecs)
}

function listerAppelantsChatPanel(ctx: Contexte): Array<{ origine: string; fichier: string; props: string[][] }> {
  const appelants: Array<{ origine: string; fichier: string; props: string[][] }> = []
  let fichiersBase: string[] = []
  try {
    fichiersBase = git(ctx.racine, ["grep", "-l", "-F", "<ChatPanel", ctx.base, "--", "src"])
      .split("\n")
      .filter(Boolean)
      .map((ligne) => ligne.slice(ctx.base.length + 1))
  } catch {
    fichiersBase = []
  }
  for (const fichier of fichiersBase) {
    if (fichier.startsWith("src/components/chat/") || /\.test\.tsx?$/.test(fichier)) continue
    const source = ctx.lireBase(fichier)
    if (source) appelants.push({ origine: "upstream", fichier, props: extraireProprietesJsx(source, "ChatPanel") })
  }
  for (const fichier of listerFichiersArbre(ctx.arbre, "src")) {
    if (fichier.startsWith("src/components/chat/") || /\.test\.tsx?$/.test(fichier)) continue
    if (appelants.some((a) => a.fichier === fichier)) continue
    const source = ctx.lireArbre(fichier)
    if (source && source.includes("<ChatPanel")) {
      appelants.push({ origine: "arbre", fichier, props: extraireProprietesJsx(source, "ChatPanel") })
    }
  }
  return appelants
}

function controlerAppelantsChatPanel(ctx: Contexte): Resultat {
  const echecs: string[] = []
  const infos: string[] = []
  const sourceNotre = ctx.lireArbre(CHEMIN_STUB_PANEL)
  const notre = sourceNotre ? extraireInterfaceProps(sourceNotre, "ChatPanelProps") : null
  if (!notre) return resultat("C03", "Usage de ChatPanel par les appelants", ["ChatPanelProps illisible dans notre composant"])
  const toutesNotre = new Set([...notre.requises, ...notre.optionnelles])
  const appelants = listerAppelantsChatPanel(ctx)
  if (appelants.length === 0) echecs.push("aucun appelant de ChatPanel trouvé (upstream ou arbre) : contrat à revoir")
  for (const appelant of appelants) {
    appelant.props.forEach((props, index) => {
      const nom = `${appelant.fichier} [${appelant.origine}] occurrence ${index + 1}`
      infos.push(`${nom} : ${props.join(", ") || "(aucune prop)"}`)
      for (const prop of props) {
        if (prop === "...spread") continue
        if (!toutesNotre.has(prop)) echecs.push(`${nom} : prop inconnue de notre ChatPanel : ${prop}`)
      }
      if (!props.includes("...spread")) {
        for (const requise of notre.requises) {
          if (!props.includes(requise)) echecs.push(`${nom} : prop requise non fournie : ${requise}`)
        }
      }
    })
  }
  const resume = resultat("C03", "Usage de ChatPanel par les appelants", echecs)
  if (resume.statut === "OK") resume.details = infos
  return resume
}

function controlerBulle(ctx: Contexte): Resultat {
  const echecs: string[] = []
  const base = ctx.lireBase(CHEMIN_STUB_BULLE)
  const notre = ctx.lireArbre(CHEMIN_STUB_BULLE)
  const layoutBase = ctx.lireBase(CHEMIN_LAYOUT)
  const layoutNotre = ctx.lireArbre(CHEMIN_LAYOUT)
  if (!base) echecs.push(`${CHEMIN_STUB_BULLE} absent de ${ctx.base}`)
  else if (!/export\s+function\s+ChatBubble\s*\(\s*\)/.test(base)) echecs.push("le stub upstream ne déclare plus ChatBubble() sans paramètre")
  if (!notre) echecs.push("ChatBubble absent de l'arbre de travail")
  else if (!/export\s+function\s+ChatBubble\s*\(\s*\)/.test(notre)) echecs.push("notre ChatBubble doit se déclarer sans paramètre : export function ChatBubble()")
  for (const [nom, source] of [["upstream", layoutBase], ["arbre", layoutNotre]] as const) {
    if (!source) {
      echecs.push(`layout.tsx illisible (${nom})`)
      continue
    }
    if (!/import\s*\{\s*ChatBubble\s*\}\s*from\s*["']@\/components\/chat\/ChatBubble["']/.test(source)) echecs.push(`layout.tsx (${nom}) n'importe plus ChatBubble depuis @/components/chat/ChatBubble`)
    if (!/<ChatBubble\s*\/>/.test(source)) echecs.push(`layout.tsx (${nom}) ne monte plus <ChatBubble />`)
  }
  return resultat("C04", "ChatBubble : signature sans paramètre et montage dans layout.tsx", echecs)
}

function controlerCssUpstream(ctx: Contexte): Resultat {
  const echecs: string[] = []
  for (const [nom, source] of [["upstream", ctx.lireBase(CHEMIN_CSS)], ["arbre", ctx.lireArbre(CHEMIN_CSS)]] as const) {
    if (!source) {
      echecs.push(`globals.css illisible (${nom})`)
      continue
    }
    for (const label of LABELS_CSS) {
      if (!source.includes(`button.fixed[aria-label="${label}"]`)) echecs.push(`globals.css (${nom}) : sélecteur button.fixed[aria-label="${label}"] manquant`)
    }
    if (!source.includes('[data-assistant-panel="compact"]')) echecs.push(`globals.css (${nom}) : sélecteur [data-assistant-panel="compact"] manquant`)
    for (const variable of VARIABLES_CSS) {
      if (!new RegExp(`${variable}\\s*:`).test(source)) echecs.push(`globals.css (${nom}) : variable ${variable} non définie`)
    }
  }
  return resultat("C05", "Contrat CSS de globals.css (sélecteurs et variables)", echecs)
}

function controlerCoherenceBulleCss(ctx: Contexte): Resultat {
  const echecs: string[] = []
  const bulle = ctx.lireArbre(CHEMIN_STUB_BULLE)
  const css = ctx.lireBase(CHEMIN_CSS) ?? ctx.lireArbre(CHEMIN_CSS)
  if (!bulle) return resultat("C06", "Notre ChatBubble vs sélecteurs CSS d'upstream", ["ChatBubble absent de l'arbre de travail"])
  if (!css) return resultat("C06", "Notre ChatBubble vs sélecteurs CSS d'upstream", ["globals.css illisible"])
  for (const label of LABELS_CSS) {
    if (!css.includes(`button.fixed[aria-label="${label}"]`)) continue
    const position = bulle.indexOf(`aria-label="${label}"`)
    if (position < 0) {
      echecs.push(`ChatBubble n'expose pas aria-label="${label}" visé par le CSS`)
      continue
    }
    const debut = bulle.lastIndexOf("<button", position)
    const fin = bulle.indexOf("</button>", position)
    const segment = debut >= 0 && fin >= 0 ? bulle.slice(debut, fin) : ""
    if (segment === "") echecs.push(`aria-label="${label}" n'est pas porté par un <button>`)
    else if (!/\bfixed\b/.test(segment)) echecs.push(`le <button aria-label="${label}"> n'a pas la classe "fixed" exigée par button.fixed[...]`)
  }
  if (!/data-assistant-panel=\{[^}]*"compact"[^}]*\}/.test(bulle)) echecs.push('ChatBubble ne pose plus data-assistant-panel="compact" sur le panneau compact')
  return resultat("C06", "Notre ChatBubble vs sélecteurs CSS d'upstream", echecs)
}

function controlerEvenement(ctx: Contexte): Resultat {
  const echecs: string[] = []
  for (const [nom, source] of [["upstream", ctx.lireBase(CHEMIN_EVENEMENTS)], ["arbre", ctx.lireArbre(CHEMIN_EVENEMENTS)]] as const) {
    if (!source) {
      echecs.push(`evenements.ts illisible (${nom})`)
      continue
    }
    const valeur = extraireConstanteTexte(source, "EVENEMENT_OUVRIR_ASSISTANT")
    if (valeur === null) echecs.push(`EVENEMENT_OUVRIR_ASSISTANT absent (${nom})`)
    else if (valeur !== VALEUR_EVENEMENT) echecs.push(`EVENEMENT_OUVRIR_ASSISTANT vaut "${valeur}" (${nom}), attendu "${VALEUR_EVENEMENT}"`)
    if (!/export\s+function\s+ouvrirAssistant\b/.test(source)) echecs.push(`ouvrirAssistant() absent (${nom})`)
  }
  const bulle = ctx.lireArbre(CHEMIN_STUB_BULLE)
  if (bulle) {
    if (!bulle.includes("addEventListener(EVENEMENT_OUVRIR_ASSISTANT")) echecs.push("ChatBubble n'écoute plus EVENEMENT_OUVRIR_ASSISTANT")
    if (!bulle.includes("removeEventListener(EVENEMENT_OUVRIR_ASSISTANT")) echecs.push("ChatBubble ne nettoie plus l'écouteur au démontage")
  }
  return resultat("C07", "Événement fenêtre EVENEMENT_OUVRIR_ASSISTANT", echecs)
}

function controlerImportsPrives(ctx: Contexte): Resultat {
  const manquants = new Map<string, Set<string>>()
  const existeArbre = (chemin: string) => existsSync(path.join(ctx.arbre, chemin))
  const noter = (specifieur: string, fichier: string) => {
    if (resoudreModule(specifieur, existeArbre)) return
    const liste = manquants.get(specifieur) ?? new Set<string>()
    liste.add(fichier)
    manquants.set(specifieur, liste)
  }
  // Code public d'upstream : tout import d'une zone privée doit exister chez nous.
  try {
    const sortie = git(ctx.racine, ["grep", "-n", "-E", "-e", "(from|import|require)[[:space:](]*[\"']@/(lib/chat|lib/ollama|hooks/use-chat)", ctx.base, "--", "src"])
    for (const ligne of sortie.split("\n").filter(Boolean)) {
      const sansBase = ligne.slice(ctx.base.length + 1)
      const m = /^([^:]+):\d+:(.*)$/.exec(sansBase)
      if (!m) continue
      for (const specifieur of extraireImportsPrives(m[2])) noter(specifieur, `${m[1]} [upstream]`)
    }
  } catch {
    // git grep rend 1 quand rien ne correspond : aucun import privé côté upstream.
  }
  // Arbre de travail (après merge) : tous les fichiers source.
  for (const fichier of listerFichiersArbre(ctx.arbre, "src")) {
    const source = ctx.lireArbre(fichier)
    if (!source) continue
    for (const specifieur of extraireImportsPrives(source)) noter(specifieur, `${fichier} [arbre]`)
  }
  const echecs: string[] = []
  for (const [specifieur, fichiers] of manquants) {
    echecs.push(`module privé manquant : ${specifieur} (importé par ${[...fichiers].join(", ")})`)
  }
  return resultat("C08", "Imports @/lib/chat/*, @/lib/ollama, @/hooks/use-chat résolus dans l'arbre de travail", echecs)
}

function controlerContratDailyOpening(ctx: Contexte, strict: boolean): Resultat {
  const echecs: string[] = []
  const avertissements: string[] = []
  const prefs = ctx.lireBase(CHEMIN_PREFS_BRIEFING)
  const prive = ctx.lireArbre(CHEMIN_DAILY_OPENING)
  if (!prefs) return resultat("C09", "Contrat de types @/lib/chat/daily-opening (briefing-prefs)", [`${CHEMIN_PREFS_BRIEFING} absent de ${ctx.base}`])
  if (!prive) return resultat("C09", "Contrat de types @/lib/chat/daily-opening (briefing-prefs)", [`${CHEMIN_DAILY_OPENING} absent de l'arbre de travail`])
  for (const nom of EXPORTS_PREFS_BRIEFING) {
    if (!new RegExp(`export\\s+(?:async\\s+)?(?:const|function)\\s+${nom}\\b`).test(prefs)) echecs.push(`upstream n'exporte plus ${nom} (contrat à réviser)`)
    if (!new RegExp(`export\\s+(?:async\\s+)?(?:const|function)\\s+${nom}\\b`).test(prive)) echecs.push(`daily-opening.ts n'exporte pas ${nom}`)
  }
  const cleUpstream = extraireConstanteTexte(prefs, "CLE_PREF_BRIEFING_AUTO")
  const clePrive = extraireConstanteTexte(prive, "CLE_PREF_BRIEFING_AUTO")
  if (cleUpstream !== clePrive) {
    const message = `CLE_PREF_BRIEFING_AUTO diverge : upstream "${cleUpstream}", plugin "${clePrive}" (la page Paramètres écrit la clé upstream, le popup du plugin lit l'autre : le briefing automatique ne s'ouvre jamais)`
    if (strict) echecs.push(message)
    else avertissements.push(`ECART CONNU : ${message}`)
  }
  const defautUpstream = /BRIEFING_AUTO_PAR_DEFAUT\s*=\s*(true|false)/.exec(prefs)?.[1]
  const defautPrive = /BRIEFING_AUTO_PAR_DEFAUT\s*=\s*(true|false)/.exec(prive)?.[1]
  if (defautUpstream !== defautPrive) echecs.push(`BRIEFING_AUTO_PAR_DEFAUT diverge : upstream ${defautUpstream}, plugin ${defautPrive}`)
  return resultat("C09", "Contrat de types @/lib/chat/daily-opening (briefing-prefs)", echecs, avertissements)
}

function controlerRoutes(ctx: Contexte): Resultat {
  const echecs: string[] = []
  for (const route of ROUTES_PLUGIN) {
    const source = ctx.lireArbre(route.fichier)
    if (!source) {
      echecs.push(`route absente : ${route.fichier}`)
      continue
    }
    const exportees = extraireMethodesHttp(source)
    for (const methode of route.methodes) {
      if (!exportees.includes(methode)) echecs.push(`${route.fichier} : méthode ${methode} non exportée`)
    }
  }
  for (const page of PAGES_PLUGIN) {
    if (!ctx.lireArbre(page)) echecs.push(`page absente : ${page}`)
  }
  return resultat("C10", "Routes et pages du plugin présentes avec leurs méthodes", echecs)
}

function controlerAncresMiddleware(ctx: Contexte): Resultat {
  const echecs: string[] = []
  for (const [nom, lire] of [["upstream", ctx.lireBase], ["arbre", ctx.lireArbre]] as const) {
    const middleware = lire("src/middleware.ts")
    if (!middleware) echecs.push(`src/middleware.ts illisible (${nom})`)
    else if (!/pathname\.startsWith\(\s*["']\/api\/mcp["']\s*\)/.test(middleware)) echecs.push(`middleware (${nom}) : /api/mcp n'est plus exempté de la session (le bearer token ne passerait plus)`)
    const entete = lire("src/lib/exploitation/entete-mutation.ts")
    if (!entete) echecs.push(`entete-mutation.ts illisible (${nom})`)
    else {
      for (const chemin of ["/api/chat", "/api/user/api-token"]) {
        if (!entete.includes(`"${chemin}"`)) echecs.push(`entete-mutation (${nom}) : ${chemin} n'est plus dans CHEMINS_HORS_EXPLOITATION`)
      }
    }
  }
  return resultat("C11", "Ancres middleware : /api/mcp public, /api/chat et api-token hors exploitation", echecs)
}

function controlerReglages(ctx: Contexte): Resultat {
  const echecs: string[] = []
  const base = ctx.lireBase("src/lib/settings.ts")
  const notre = ctx.lireArbre("src/lib/settings.ts")
  if (!base) echecs.push("settings.ts absent d'upstream")
  else {
    if (!/secret\?\s*:\s*boolean/.test(base)) echecs.push("SettingDefinition d'upstream n'a plus le champ secret?: boolean")
    if (!/envKey\?\s*:\s*string/.test(base)) echecs.push("SettingDefinition d'upstream n'a plus le champ envKey?: string")
    if (!/export\s+const\s+settingsRegistry\b/.test(base)) echecs.push("settingsRegistry n'est plus exporté par upstream")
  }
  if (!notre) echecs.push("settings.ts absent de l'arbre de travail")
  else {
    for (const cle of CLES_REGLAGES) {
      if (!notre.includes(`"${cle}": {`)) echecs.push(`clé de réglage manquante dans settingsRegistry : ${cle}`)
    }
  }
  return resultat("C12", "Clés de réglages chat.* et forme de SettingDefinition", echecs)
}

function controlerGitignore(ctx: Contexte): Resultat {
  const echecs: string[] = []
  const base = ctx.lireBase(".gitignore")
  if (!base) return resultat("C13", "Zones .gitignore privées d'upstream", [`.gitignore absent de ${ctx.base}`])
  const lignes = new Set(base.split("\n").map((l) => l.trim()))
  for (const zone of ZONES_GITIGNORE) {
    if (!lignes.has(zone)) echecs.push(`zone absente du .gitignore d'upstream : ${zone}`)
  }
  return resultat("C13", "Zones .gitignore privées d'upstream", echecs)
}

function controlerDependances(ctx: Contexte): Resultat {
  const echecs: string[] = []
  const notre = ctx.lireArbre("package.json")
  if (!notre) return resultat("C14", "Dépendances react-markdown et remark-gfm", ["package.json illisible"])
  try {
    const pkg = JSON.parse(notre) as { dependencies?: Record<string, string> }
    for (const dep of DEPENDANCES_REQUISES) {
      if (!pkg.dependencies?.[dep]) echecs.push(`dépendance absente de package.json : ${dep}`)
    }
  } catch {
    echecs.push("package.json n'est pas un JSON valide")
  }
  return resultat("C14", "Dépendances react-markdown et remark-gfm", echecs)
}

function lireExclusionsTsconfig(source: string): string[] | null {
  try {
    const json = JSON.parse(source) as { exclude?: string[] }
    return json.exclude ?? []
  } catch {
    return null
  }
}

function controlerTsconfig(ctx: Contexte): Resultat {
  const echecs: string[] = []
  for (const [nom, source] of [["upstream", ctx.lireBase("tsconfig.json")], ["arbre", ctx.lireArbre("tsconfig.json")]] as const) {
    if (!source) {
      echecs.push(`tsconfig.json illisible (${nom})`)
      continue
    }
    const exclusions = lireExclusionsTsconfig(source)
    if (!exclusions) {
      echecs.push(`tsconfig.json (${nom}) n'est pas un JSON strict`)
      continue
    }
    for (const attendue of EXCLUSIONS_TSCONFIG) {
      if (!exclusions.includes(attendue)) echecs.push(`tsconfig.json (${nom}) : exclusion manquante : ${attendue}`)
    }
  }
  return resultat("C15", "Exclusions tsconfig (mcp-server, tests)", echecs)
}

function controlerGreffeLayout(ctx: Contexte): Resultat {
  const echecs: string[] = []
  const notre = ctx.lireArbre(CHEMIN_LAYOUT)
  if (!notre) return resultat("C16", "Greffe du plugin dans layout.tsx", ["layout.tsx illisible"])
  if (!/<DailyBriefingPopup\s*\/>/.test(notre)) echecs.push("layout.tsx ne monte plus <DailyBriefingPopup />")
  if (!ctx.lireArbre("src/components/chat/DailyBriefingPopup.tsx")) echecs.push("DailyBriefingPopup.tsx absent")
  return resultat("C16", "Greffe du plugin dans layout.tsx", echecs)
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

interface Options {
  base: string
  arbre: string | null
  strict: boolean
  aide: boolean
}

export function lireOptions(argv: string[]): Options | string {
  const options: Options = { base: "origin/main", arbre: null, strict: false, aide: false }
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]
    if (argument === "--strict") options.strict = true
    else if (argument === "--aide" || argument === "--help") options.aide = true
    else if (argument === "--base" || argument === "--arbre") {
      const valeur = argv[i + 1]
      if (!valeur) return `${argument} attend une valeur`
      if (argument === "--base") options.base = valeur
      else options.arbre = valeur
      i++
    } else if (argument.startsWith("--base=")) options.base = argument.slice("--base=".length)
    else if (argument.startsWith("--arbre=")) options.arbre = argument.slice("--arbre=".length)
    else return `option inconnue : ${argument}`
  }
  if (options.base.startsWith("-")) return "la référence --base ne peut pas commencer par un tiret"
  return options
}

function executer(): number {
  const options = lireOptions(process.argv.slice(2))
  if (typeof options === "string") {
    console.error(`Erreur d'usage : ${options}`)
    return 2
  }
  if (options.aide) {
    console.log("Usage : npx tsx scripts/verifierContratAssistant.ts [--base <ref>] [--arbre <dossier>] [--strict]")
    return 0
  }
  const racine = path.resolve(__dirname, "..")
  const arbre = path.resolve(options.arbre ?? racine)
  console.log(`Contrat assistant : base ${options.base}, arbre ${arbre}`)
  console.log("")

  const resultats: Resultat[] = []
  try {
    git(racine, ["rev-parse", "--verify", "--quiet", `${options.base}^{commit}`])
    resultats.push({ id: "C01", libelle: `Référence de base ${options.base} valide`, statut: "OK", details: [] })
  } catch {
    resultats.push({
      id: "C01",
      libelle: `Référence de base ${options.base} valide`,
      statut: "ECHEC",
      details: [`la référence git "${options.base}" est introuvable (git fetch origin ? faute de frappe ?)`],
    })
    return afficher(resultats, true)
  }

  const ctx = construireContexte(options.base, arbre, racine)
  const controles: Array<() => Resultat> = [
    () => controlerPropsChatPanel(ctx),
    () => controlerAppelantsChatPanel(ctx),
    () => controlerBulle(ctx),
    () => controlerCssUpstream(ctx),
    () => controlerCoherenceBulleCss(ctx),
    () => controlerEvenement(ctx),
    () => controlerImportsPrives(ctx),
    () => controlerContratDailyOpening(ctx, options.strict),
    () => controlerRoutes(ctx),
    () => controlerAncresMiddleware(ctx),
    () => controlerReglages(ctx),
    () => controlerGitignore(ctx),
    () => controlerDependances(ctx),
    () => controlerTsconfig(ctx),
    () => controlerGreffeLayout(ctx),
  ]
  for (const controle of controles) {
    try {
      resultats.push(controle())
    } catch (erreur) {
      resultats.push({
        id: "C??",
        libelle: "Contrôle interrompu",
        statut: "ECHEC",
        details: [erreur instanceof Error ? erreur.message : String(erreur)],
      })
    }
  }
  return afficher(resultats, false)
}

function afficher(resultats: Resultat[], interrompu: boolean): number {
  for (const r of resultats) {
    const etiquette = r.statut === "OK" ? "[OK]     " : r.statut === "ECHEC" ? "[ECHEC]  " : "[AVERT.] "
    console.log(`${etiquette}${r.id} ${r.libelle}`)
    for (const detail of r.details) console.log(`           ${detail}`)
  }
  const echecs = resultats.filter((r) => r.statut === "ECHEC").length
  const avertissements = resultats.filter((r) => r.statut === "AVERTISSEMENT").length
  const ok = resultats.filter((r) => r.statut === "OK").length
  console.log("")
  console.log(`Résumé : ${ok} OK, ${avertissements} avertissement(s), ${echecs} échec(s)${interrompu ? " (contrôles interrompus)" : ""}`)
  console.log(echecs === 0 ? "Contrat respecté." : "Contrat ROMPU : corriger avant de pousser le merge.")
  return echecs === 0 ? 0 : 1
}

if (path.basename(process.argv[1] ?? "").startsWith("verifierContratAssistant")) {
  process.exit(executer())
}
