
import { chargerTachesDuJour } from "@/lib/notifications/queries";
import { recupererAlertesMeteoJour } from "@/lib/notifications/queries";
import { detecterAlertesUrgentes } from "@/lib/notifications/queries";
import type { TacheJour } from "@/lib/notifications/types";
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
