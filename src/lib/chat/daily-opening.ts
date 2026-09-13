/**
 * @file daily-opening.ts
 * @description Module de contremarque publique minimale pour le briefing quotidien.
 * Ce module privé du créateur étant absent du dépôt public, ce stub minimal permet
 * de compiler le projet et de faire tourner l'application. À retirer ou remplacer
 * lorsque le vrai module sera publié par le créateur.
 *
 * Convention : camelCase + FR
 */

import prisma from "@/lib/prisma";

export const BRIEFING_AUTO_PAR_DEFAUT = false;
export const CLE_PREF_BRIEFING_AUTO = 'briefingAuto';

/**
 * Vérifie si le briefing a déjà été affiché aujourd'hui pour l'utilisateur.
 */
export async function hasAlreadyShownBriefingToday(userId: string): Promise<boolean> {
  const date = new Date().toISOString().split('T')[0];
  const paramId = `briefing.dernierAffichage.${userId}`;
  const param = await prisma.parametre.findUnique({
    where: { id: paramId },
  });
  return param?.valeur === date;
}

/**
 * Marque le briefing comme affiché aujourd'hui pour l'utilisateur.
 */
export async function markBriefingAsShown(userId: string): Promise<void> {
  const date = new Date().toISOString().split('T')[0];
  const paramId = `briefing.dernierAffichage.${userId}`;
  await prisma.parametre.upsert({
    where: { id: paramId },
    update: { valeur: date },
    create: { id: paramId, valeur: date },
  });
}

/**
 * Détermine si le briefing automatique est activé dans les préférences de l'utilisateur.
 *
 * @param prefs Les préférences de l'utilisateur ou null/undefined.
 * @returns true si activé, false sinon.
 */
export function briefingAutoActive(
  prefs: Record<string, unknown> | null | undefined
): boolean {
  if (!prefs) {
    return BRIEFING_AUTO_PAR_DEFAUT;
  }
  const valeur = prefs[CLE_PREF_BRIEFING_AUTO];
  if (typeof valeur === 'boolean') {
    return valeur;
  }
  return BRIEFING_AUTO_PAR_DEFAUT;
}

/**
 * Calcule la fenêtre temporelle du briefing quotidien pour une date donnée.
 * Utilisé principalement par les scripts de vérification.
 *
 * @param now Date de référence.
 * @returns Un objet contenant le jour au format YYYY-MM-DD, le fuseau horaire,
 *          la date de début (minuit local) et la date de fin (24h plus tard).
 */
export function dailyBriefingWindow(now: Date): {
  day: string;
  timeZone: string;
  start: Date;
  end: Date;
} {
  const timeZone = 'Europe/Paris';

  // Récupération de la date au format AAAA-MM-JJ local Europe/Paris
  const formatter = new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value || '2026';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  const dayStr = parts.find((p) => p.type === 'day')?.value || '01';
  const day = `${year}-${month}-${dayStr}`;

  // Début et fin à minuit local
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return {
    day,
    timeZone,
    start,
    end,
  };
}
