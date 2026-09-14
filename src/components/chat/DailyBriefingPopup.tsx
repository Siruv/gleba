"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { fetchDailyBriefing } from "@/app/actions/chat-briefing"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { briefingAutoActive } from "@/lib/chat/daily-opening"
import { Button } from "@/components/ui/button"
import type { BriefingPayload } from "@/lib/chat/daily-briefing"

export function DailyBriefingPopup() {
  const { data: session } = useSession()
  const [briefing, setBriefing] = useState<BriefingPayload | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!session?.user?.id) {
      return
    }

    const init = async () => {
      try {
        const res = await fetch("/api/user/preferences")
        const prefs = await res.json()
        
        if (briefingAutoActive(prefs)) {
          const data = await fetchDailyBriefing(session.user.id)
          if (data && (data.taches.length > 0 || data.alertesUrgentes.length > 0 || data.alertesMeteo.length > 0)) {
            setBriefing(data)
            setOpen(true)
          }
        }
      } catch (e) {
        console.error("Erreur chargement briefing:", e)
      }
    }
    
    void init()
  }, [session])

  if (!briefing) return null

  const ouvrirChat = () => {
    window.dispatchEvent(new CustomEvent("ouvrir-chat", {
      detail: { section: "briefing", sectionLabel: "Briefing du jour" }
    }))
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>☀️ Briefing du jour</DialogTitle>
          <DialogDescription>
            Voici un résumé de vos activités et alertes pour aujourd'hui.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {briefing.taches.length > 0 && (
            <div>
              <h4 className="font-semibold">Tâches du jour :</h4>
              <ul className="list-disc pl-5">
                {briefing.taches.map((t) => {
                  const label = `${t.type} : ${t.especeNom}${t.varieteNom ? ' (' + t.varieteNom + ')' : ''}`
                  return <li key={t.id}>{label} (le {t.date})</li>
                })}
              </ul>
            </div>
          )}
          {briefing.alertesUrgentes.length > 0 && (
            <div>
              <h4 className="font-semibold text-red-600">Alertes urgentes :</h4>
              <ul className="list-disc pl-5">
                {briefing.alertesUrgentes.map((a, i) => (
                  <li key={i}>{a.message}</li>
                ))}
              </ul>
            </div>
          )}
          {briefing.alertesMeteo.length > 0 && (
            <div>
              <h4 className="font-semibold text-blue-600">Alertes météo :</h4>
              <ul className="list-disc pl-5">
                {briefing.alertesMeteo.map((a, i) => (
                  <li key={i}>{a.message}</li>
                ))}
              </ul>
            </div>
          )}
          <Button onClick={ouvrirChat}>En discuter avec l'assistant</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
