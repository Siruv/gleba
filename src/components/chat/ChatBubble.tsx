"use client"

import { useEffect, useState } from "react"
import { Bot, X } from "lucide-react"

import { ChatPanel } from "@/components/chat/ChatPanel"
import { EVENEMENT_OUVRIR_ASSISTANT, type DetailOuvrirAssistant } from "@/lib/accueil/evenements"

function estObjet(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function ChatBubble() {
  const [chatActif, setChatActif] = useState<boolean | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [chatContext, setChatContext] = useState<{ section?: string; sectionLabel?: string } | null>(null)
  const [questionSuggeree, setQuestionSuggeree] = useState<string | undefined>(undefined)

  useEffect(() => {
    const handleOuvrirChat = (e: Event) => {
      const customEvent = e as CustomEvent
      if (customEvent.detail) {
        setChatContext({
          section: customEvent.detail.section,
          sectionLabel: customEvent.detail.sectionLabel,
        })
      }
      setIsOpen(true)
    }

    const handleOuvrirAssistant = (e: Event) => {
      const detail = (e as CustomEvent<DetailOuvrirAssistant | undefined>).detail
      const question = typeof detail?.question === "string" ? detail.question : undefined
      setQuestionSuggeree(question)
      setIsOpen(true)
    }

    window.addEventListener("ouvrir-chat", handleOuvrirChat as EventListener)
    window.addEventListener(EVENEMENT_OUVRIR_ASSISTANT, handleOuvrirAssistant)
    return () => {
      window.removeEventListener("ouvrir-chat", handleOuvrirChat as EventListener)
      window.removeEventListener(EVENEMENT_OUVRIR_ASSISTANT, handleOuvrirAssistant)
    }
  }, [])


  useEffect(() => {
    let composantActif = true

    const verifierChat = async () => {
      try {
        const response = await fetch("/api/chat/status", { cache: "no-store" })
        if (!response.ok) {
          if (composantActif) setChatActif(false)
          return
        }

        const data: unknown = await response.json()
        const actif = estObjet(data) && data.actif === true
        if (composantActif) setChatActif(actif)
      } catch {
        if (composantActif) setChatActif(false)
      }
    }

    void verifierChat()
    return () => {
      composantActif = false
    }
  }, [])

  if (chatActif !== true) return null

  const fermerChat = () => {
    setIsOpen(false)
    setIsExpanded(false)
    setChatContext(null)
    setQuestionSuggeree(undefined)
  }


  return (
    <>
      {!isOpen && (
        <button
          type="button"
          className="fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
          onClick={() => setIsOpen(true)}
          aria-label="Assistant IA"
          title="Assistant IA"
        >
          <Bot className="h-6 w-6" aria-hidden="true" />
        </button>
      )}

      {isOpen && !isExpanded && (
        <button
          type="button"
          className="fixed bottom-4 right-4 z-[60] flex h-12 w-12 items-center justify-center rounded-full bg-slate-700 text-white shadow-lg transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
          onClick={fermerChat}
          aria-label="Fermer l'assistant"
          title="Fermer l'assistant"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      )}

      {isOpen && (
        <div
          data-assistant-panel={isExpanded ? undefined : "compact"}
          className={
            isExpanded
              ? "fixed z-[70] inset-2 sm:inset-5 lg:inset-y-8 lg:left-1/2 lg:right-auto lg:w-[min(1100px,calc(100vw-4rem))] lg:-translate-x-1/2"
              : "fixed z-50 bottom-2 left-4 right-4 h-[45vh] max-w-sm mx-auto sm:mx-0 sm:left-auto sm:bottom-20 sm:right-4 sm:h-[min(540px,calc(100dvh_-_var(--app-header-visible-h,var(--app-header-h,0px))_-_5rem_-_1rem))] sm:w-[400px] sm:max-w-none"
          }
        >
          <ChatPanel
            onClose={fermerChat}
            isExpanded={isExpanded}
            onToggleExpanded={() => setIsExpanded((current) => !current)}
            section={chatContext?.section}
            sectionLabel={chatContext?.sectionLabel}
            questionInitiale={questionSuggeree}
          />
        </div>
      )}
    </>
  )
}
