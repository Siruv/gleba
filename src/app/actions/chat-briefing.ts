"use server"

import { getDailyBriefingData } from "@/lib/chat/daily-briefing"
import { hasAlreadyShownBriefingToday, markBriefingAsShown } from "@/lib/chat/daily-opening"

export async function fetchDailyBriefing(userId: string) {
  const alreadyShown = await hasAlreadyShownBriefingToday(userId)
  if (alreadyShown) return null

  const data = await getDailyBriefingData(userId)
  await markBriefingAsShown(userId)
  return data
}
