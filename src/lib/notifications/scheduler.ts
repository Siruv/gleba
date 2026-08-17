/**
 * Scheduler interne au conteneur (node-cron), initialisé au démarrage du
 * serveur Next.js via `src/instrumentation.ts` (register()).
 *
 * - Résumé quotidien : vérifié chaque minute selon les réglages en base.
 * - Surveillance météo + urgences : vérifiée toutes les 5 minutes selon
 *   l'intervalle configuré en base, plus un premier scan ~30 s après le boot.
 *
 * Robustesse : l'init est enveloppé en try/catch (ne fait jamais crasher le
 * démarrage) ; chaque run est isolé et ne peut pas se chevaucher avec le
 * précédent.
 */

import cron from "node-cron"
import { doitLancerScan, estHeureResume } from "./config"
import {
  envoyerAlertesMeteoTempsReel,
  envoyerAlertesUrgentes,
  envoyerResumeQuotidien,
} from "./sender"
import { pushConfigure } from "@/lib/push"
import { getSetting } from "@/lib/settings"

let initialized = false

/** Délai avant le premier scan au démarrage (laisse la DB se réveiller). */
const DELAI_PREMIER_SCAN_MS = 30_000

let scanEnCours = false
let dernierScanMs = 0
let dernierResumeJour: string | null = null

async function runScanMeteoEtUrgent(): Promise<void> {
  if (scanEnCours) {
    console.warn("[notifications] Scan précédent encore en cours, saut de cycle")
    return
  }
  scanEnCours = true
  try {
    const meteo = await envoyerAlertesMeteoTempsReel()
    const urgentes = await envoyerAlertesUrgentes()
    if (meteo > 0 || urgentes > 0) {
      console.log(`[notifications] Scan : ${meteo} alerte(s) météo, ${urgentes} action(s) urgente(s) envoyée(s)`)
    }
  } catch (error) {
    console.error("[notifications] Échec du scan météo/urgent:", error)
  } finally {
    scanEnCours = false
  }
}

function getJourDansTimezone(date: Date, timezone: string): string {
  const formatter = (fuseau: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: fuseau,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date)
    const year = parts.find((part) => part.type === "year")?.value ?? ""
    const month = parts.find((part) => part.type === "month")?.value ?? ""
    const day = parts.find((part) => part.type === "day")?.value ?? ""
    return `${year}-${month}-${day}`
  }

  try {
    return formatter(timezone)
  } catch {
    return formatter("Europe/Paris")
  }
}

/**
 * Initialise le scheduler. Appelé une seule fois (module-level flag) depuis
 * instrumentation.register(). Ne lève jamais.
 */
export function initNotifScheduler(): void {
  if (initialized) return
  // Pendant `next build`, register() peut être exécuté par le serveur de
  // compilation : on ne planifie rien.
  if (process.env.NEXT_PHASE === "phase-production-build") return

  initialized = true
  try {
    if (!pushConfigure()) {
      console.log("[notifications] Push désactivé — définir VAPID_PUBLIC_KEY et VAPID_PRIVATE_KEY")
    }

    // Premier scan au démarrage (météo + urgences), après un court délai.
    setTimeout(async () => {
      try {
        const enabled = await getSetting("notif.enabled")
        if (!enabled) return
        dernierScanMs = Date.now()
        await runScanMeteoEtUrgent()
      } catch (error) {
        console.error("[notifications] Premier scan en échec:", error)
      }
    }, DELAI_PREMIER_SCAN_MS)

    // Granularité fixe de 5 minutes, avec intervalle effectif relu en base.
    cron.schedule("*/5 * * * *", async () => {
      try {
        const enabled = await getSetting("notif.enabled")
        if (!enabled) return
        const intervalMin = await getSetting("notif.meteoIntervalMin")
        const nowMs = Date.now()
        if (!doitLancerScan(nowMs, dernierScanMs, intervalMin)) return
        dernierScanMs = nowMs
        await runScanMeteoEtUrgent()
      } catch (error) {
        console.error("[notifications] Scan planifié en échec:", error)
      }
    })

    // Vérification chaque minute pour appliquer immédiatement les réglages
    // d'heure et de fuseau sans recréer le cron.
    cron.schedule("* * * * *", async () => {
      try {
        const enabled = await getSetting("notif.enabled")
        if (!enabled) return
        const resumeHeure = await getSetting("notif.resumeHeure")
        const timezone = await getSetting("notif.timezone")
        const maintenant = new Date()
        const jour = getJourDansTimezone(maintenant, timezone)

        if (dernierResumeJour !== null && dernierResumeJour !== jour) {
          dernierResumeJour = null
        }
        if (dernierResumeJour === jour || !estHeureResume(maintenant, resumeHeure, timezone)) {
          return
        }

        // Marqué avant l'appel async pour éviter deux envois si un tick
        // démarre avant la fin du précédent.
        dernierResumeJour = jour
        const nombreEnvoyes = await envoyerResumeQuotidien()
        if (nombreEnvoyes > 0) {
          console.log(`[notifications] Résumé quotidien envoyé à ${nombreEnvoyes} destinataire(s)`)
        }
      } catch (error) {
        console.error("[notifications] Résumé quotidien en échec:", error)
      }
    })

    console.log("[notifications] Scheduler démarré — scan météo/urgent vérifié toutes les 5 min, résumé quotidien vérifié chaque minute")
  } catch (error) {
    console.error("[notifications] Impossible de démarrer le scheduler:", error)
  }
}
