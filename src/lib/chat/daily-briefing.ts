
import { chargerTachesDuJour } from "@/lib/notifications/queries";
import { recupererAlertesMeteoJour } from "@/lib/notifications/queries";
import { detecterAlertesUrgentes } from "@/lib/notifications/queries";
import { jourCivilStocke, jourLocalISO } from "@/lib/jour-civil";
import type { TacheJour, TypeTache } from "@/lib/notifications/types";
import type { AlerteMeteoNotification, AlerteUrgente } from "@/lib/notifications/types";

export interface BriefingPayload {
  taches: TacheJour[];
  alertesMeteo: AlerteMeteoNotification[];
  alertesUrgentes: AlerteUrgente[];
}

/**
 * Vrai quand le briefing n'a rien à afficher : ni tâche, ni alerte urgente,
 * ni alerte météo. Source unique de la condition d'affichage du popup, lue par
 * l'action serveur (marquage « vu ») et par le composant.
 */
export function briefingEstVide(data: BriefingPayload | null | undefined): boolean {
  if (!data) return true;
  return data.taches.length === 0 && data.alertesUrgentes.length === 0 && data.alertesMeteo.length === 0;
}

/**
 * Assemble les données pour le briefing quotidien de l'utilisateur.
 */
export async function getDailyBriefingData(userId: string): Promise<BriefingPayload> {
  const [taches, alertesMeteo, alertesUrgentes] = await Promise.all([
    chargerTachesDuJour(userId),
    recupererAlertesMeteoJour(userId),
    detecterAlertesUrgentes(userId),
  ]);

  return {
    taches,
    alertesMeteo,
    alertesUrgentes,
  };
}

// ---------------------------------------------------------------------------
// Présentation du briefing (fonctions pures, testées sans React)
// ---------------------------------------------------------------------------

const MS_JOUR = 86_400_000;

/** Minuscules sans accents, pour comparer des noms saisis à la main. */
function normaliser(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Date lisible en français : « aujourd'hui », « demain », « hier », sinon
 * « lundi 9 novembre » (avec l'année si elle diffère de celle d'aujourd'hui).
 * Raisonne en jour civil local (`jour-civil`), jamais sur l'ISO brut ; chaîne
 * vide si la date est illisible.
 */
export function formaterDateFr(date: string | Date, aujourdhui: Date = new Date()): string {
  const jour = jourCivilStocke(date);
  if (!jour) return "";
  const aujourdhuiJour = jourLocalISO(aujourdhui);
  const ecart = Math.round(
    (Date.parse(`${jour}T00:00:00Z`) - Date.parse(`${aujourdhuiJour}T00:00:00Z`)) / MS_JOUR,
  );
  if (ecart === 0) return "aujourd'hui";
  if (ecart === 1) return "demain";
  if (ecart === -1) return "hier";
  const memeAnnee = jour.slice(0, 4) === aujourdhuiJour.slice(0, 4);
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(memeAnnee ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(new Date(`${jour}T12:00:00Z`));
}

/**
 * Vrai si le nom de variété n'apporte rien : vide, placeholder d'upstream
 * (« <Espèce> — Non spécifiée », cf. `ensurePlaceholderVariete`), ou nom qui
 * commence déjà par celui de l'espèce.
 */
export function varieteEstRedondante(especeNom: string, varieteNom: string | null | undefined): boolean {
  if (!varieteNom || !varieteNom.trim()) return true;
  const variete = normaliser(varieteNom);
  if (variete.includes("non specifiee")) return true;
  const espece = normaliser(especeNom);
  return espece !== "" && variete.startsWith(espece);
}

/**
 * Verbe à l'infinitif, formulation de la page d'accueil d'upstream
 * (`composition.server.ts` : « Semer Chou brocoli A1 »). Sa table n'est pas
 * exportée et vit dans des fichiers d'upstream qu'on ne modifie pas : on aligne
 * donc les libellés ici.
 */
const VERBE_ACTION: Record<TypeTache, string> = {
  semis: "Semer",
  plantation: "Planter",
  recolte: "Récolter",
  irrigation: "Arroser",
}

/** Libellé d'une tâche, comme l'accueil : « Semer Chou brocoli A1 ». */
export function libelleTache(tache: Pick<TacheJour, "type" | "especeNom" | "varieteNom" | "plancheName">): string {
  const verbe = VERBE_ACTION[tache.type] ?? "Faire"
  const variete = varieteEstRedondante(tache.especeNom, tache.varieteNom) ? "" : ` (${tache.varieteNom!.trim()})`
  const planche = tache.plancheName?.trim() ? ` ${tache.plancheName.trim()}` : ""
  return `${verbe} ${tache.especeNom}${variete}${planche}`
}

/** Pluriel simple : « 1 tâche », « 3 tâches ». */
export function compteur(nombre: number, singulier: string, pluriel = `${singulier}s`): string {
  return `${nombre} ${nombre > 1 ? pluriel : singulier}`;
}

const TYPE_PAR_VERBE: Record<string, TypeTache> = {
  Semer: "semis",
  Planter: "plantation",
  "Récolter": "recolte",
};

/**
 * Éléments d'une alerte « Cette semaine (du … au …) : Semer X (planche A1) ;
 * Planter Y. » (`detecterTachesItpSemaine`). Renvoie `null` si le message n'a
 * pas cette forme ou s'il est tronqué (« … et N autres »), auquel cas on ne
 * sait pas tout ce qu'il couvre.
 */
function elementsAlerteSemaine(message: string): { type: TypeTache; espece: string; planche: string | null }[] | null {
  const m = /^Cette semaine \(du [^)]*\) : ([\s\S]*)\.$/.exec(message);
  if (!m || m[1].includes("…")) return null;
  const elements: { type: TypeTache; espece: string; planche: string | null }[] = [];
  for (const segment of m[1].split(" ; ")) {
    const v = /^(Semer|Planter|Récolter) ([\s\S]+)$/.exec(segment);
    if (!v) return null;
    for (const item of v[2].split(", ")) {
      const p = /^(.*) \(planche (.*)\)$/.exec(item);
      elements.push({ type: TYPE_PAR_VERBE[v[1]], espece: p ? p[1] : item, planche: p ? p[2] : null });
    }
  }
  return elements;
}

/**
 * Retire les alertes urgentes qui répètent une tâche du jour.
 *
 * Règle : l'alerte « tache-itp-semaine » est un message agrégé dont la `key`
 * (`tache-itp-semaine:AAAA-Sww`) est propre à la semaine, donc inutilisable
 * pour comparer une action. On lit donc ses éléments (verbe, espèce, planche)
 * et on masque l'alerte seulement si CHACUN correspond à une tâche du jour
 * de même type, même espèce et même planche. Dès qu'un élément n'est pas
 * couvert (ou que le message est tronqué ou illisible), l'alerte reste :
 * mieux vaut un doublon qu'une information perdue. Les autres alertes sont
 * toujours conservées.
 */
export function dedoublonnerAlertes(
  taches: readonly TacheJour[],
  alertes: readonly AlerteUrgente[],
): AlerteUrgente[] {
  return alertes.filter((alerte) => {
    if (alerte.type !== "tache-itp-semaine") return true;
    const elements = elementsAlerteSemaine(alerte.message);
    if (!elements || elements.length === 0) return true;
    const couvert = elements.every((el) =>
      taches.some(
        (t) =>
          t.type === el.type &&
          normaliser(t.especeNom) === normaliser(el.espece) &&
          normaliser(t.plancheName ?? "") === normaliser(el.planche ?? ""),
      ),
    );
    return !couvert;
  });
}
