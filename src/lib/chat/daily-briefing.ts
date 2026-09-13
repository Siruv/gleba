
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
