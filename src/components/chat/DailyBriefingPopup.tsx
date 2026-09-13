"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { fetchDailyBriefing } from "@/app/actions/chat-briefing"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"

export function DailyBriefingPopup() {
  const { data: session } = useSession()
  const [briefing, setBriefing] = useState<any>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!session?.user?.id) return
    fetchDailyBriefing(session.user.id).then((data) => {
      if (data) {
        setBriefing(data)
        setOpen(true)
      }
    })
  }, [session])

  if (!briefing) return null

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
          <p>Tâches : {briefing.taches.length}</p>
          <p>Alertes urgentes : {briefing.alertesUrgentes.length}</p>
          <p>Alertes météo : {briefing.alertesMeteo.length}</p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
