"use server"

import { requireAuth } from "@/lib/auth-utils"
import { getActeurId } from "@/lib/exploitation/garde-session"
import { getDailyBriefingData } from "@/lib/chat/daily-briefing"
import { hasAlreadyShownBriefingToday, markBriefingAsShown } from "@/lib/chat/daily-opening"

/**
 * Briefing du jour de la personne connectée. Aucun paramètre : une action
 * serveur est un point d'entrée HTTP, l'identité vient donc de la session.
 * Les données sont celles de l'exploitation (tenant) ; le marqueur « déjà
 * affiché » est propre à la personne (acteur).
 */
export async function fetchDailyBriefing() {
  const session = await requireAuth()
  const acteurId = getActeurId(session)
  if (await hasAlreadyShownBriefingToday(acteurId)) return null

  const data = await getDailyBriefingData(session.user.id)
  await markBriefingAsShown(acteurId)
  return data
}
