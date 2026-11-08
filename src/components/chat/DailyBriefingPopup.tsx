"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { useSession } from "next-auth/react"
import { fetchDailyBriefing } from "@/app/actions/chat-briefing"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { briefingAutoActive } from "@/lib/briefing-prefs"
import { CLASSES_BOUTON_PRINCIPAL } from "@/components/accueil/boutons"
import {
  briefingEstVide,
  dedoublonnerAlertes,
  formaterDateFr,
  libelleTache,
  type BriefingPayload,
} from "@/lib/chat/daily-briefing"

export function DailyBriefingPopup() {
  const { data: session } = useSession()
  const [briefing, setBriefing] = useState<BriefingPayload | null>(null)
  const [open, setOpen] = useState(false)
  const contenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!session?.user?.id) {
      return
    }

    const init = async () => {
      try {
        const res = await fetch("/api/user/preferences")
        const prefs = await res.json()
        
        if (briefingAutoActive(prefs)) {
          const data = await fetchDailyBriefing()
          if (data && !briefingEstVide(data)) {
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

  const alertes = dedoublonnerAlertes(briefing.taches, briefing.alertesUrgentes)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Marge latérale de 1 rem sur mobile (la boîte ne touche pas les bords) ;
          le contenu défile dans la boîte, le bouton reste collé en bas. */}
      <DialogContent
        ref={contenuRef}
        // Radix donne le focus au premier élément focalisable : le popup s'ouvre
        // sans geste de l'utilisateur, donc :focus-visible s'applique et un anneau
        // s'affichait sur « En discuter ». Le focus va au conteneur (le titre reste
        // annoncé via aria-labelledby, Tab atteint le bouton, Échap ferme).
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          contenuRef.current?.focus()
        }}
        className="w-[calc(100%-2rem)] max-w-md rounded-lg border-lin bg-craie font-ui text-encre focus:outline-none focus-visible:outline-none">
        <DialogHeader>
          <DialogTitle>Briefing du jour</DialogTitle>
          <DialogDescription>
            Voici un résumé de vos activités et alertes pour aujourd&apos;hui.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          {briefing.taches.length > 0 && (
            <Section titre="Tâches" nombre={briefing.taches.length} classeTitre="text-sauge">
              {briefing.taches.map((t) => (
                <Ligne key={t.id} texte={libelleTache(t)} detail={formaterDateFr(t.date)} />
              ))}
            </Section>
          )}
          {alertes.length > 0 && (
            <Section titre="Alertes urgentes" nombre={alertes.length} classeTitre="text-argile">
              {alertes.map((a) => (
                <Ligne key={a.key} texte={a.message} />
              ))}
            </Section>
          )}
          {briefing.alertesMeteo.length > 0 && (
            <Section titre="Météo" nombre={briefing.alertesMeteo.length} classeTitre="text-eau">
              {briefing.alertesMeteo.map((a) => (
                <Ligne key={a.key} texte={a.message} />
              ))}
            </Section>
          )}
          <div className="sticky bottom-0 -mb-2 bg-craie pb-2 pt-2">
            <button type="button" onClick={ouvrirChat} className={`${CLASSES_BOUTON_PRINCIPAL} w-full`}>
              En discuter avec l&apos;assistant
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Section({ titre, nombre, classeTitre, children }: {
  titre: string
  nombre: number
  classeTitre: string
  children: ReactNode
}) {
  return (
    <section>
      <h3 className={`mb-1 text-sm font-semibold ${classeTitre}`}>
        {titre} <span className="font-normal text-ardoise">({nombre})</span>
      </h3>
      <ul className="divide-y divide-lin-doux border-y border-lin-doux">{children}</ul>
    </section>
  )
}

function Ligne({ texte, detail }: { texte: string; detail?: string }) {
  return (
    <li className="py-2 text-sm leading-snug">
      {texte}
      {detail ? <span className="block text-xs text-ardoise">{detail}</span> : null}
    </li>
  )
}
