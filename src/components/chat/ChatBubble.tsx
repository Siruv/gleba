"use client"

import { useEffect, useState } from "react"
import { Bot } from "lucide-react"

import { ChatPanel } from "@/components/chat/ChatPanel"

function estObjet(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function ChatBubble() {
  const [chatActif, setChatActif] = useState<boolean | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

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
  }

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          className="fixed bottom-4 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
          onClick={() => setIsOpen(true)}
          aria-label="Ouvrir l'assistant IA"
          title="Ouvrir l'assistant IA"
        >
          <Bot className="h-6 w-6" aria-hidden="true" />
        </button>
      )}

      {isOpen && (
        <div
          className={
            isExpanded
              ? "fixed z-[70] inset-2 sm:inset-5 lg:inset-y-8 lg:left-1/2 lg:right-auto lg:w-[min(1100px,calc(100vw-4rem))] lg:-translate-x-1/2"
              : "fixed z-50 bottom-2 left-4 right-4 h-[45vh] max-w-sm mx-auto sm:mx-0 sm:left-auto sm:bottom-4 sm:right-4 sm:h-[540px] sm:w-[400px] sm:max-w-none"
          }
        >
          <ChatPanel
            onClose={fermerChat}
            isExpanded={isExpanded}
            onToggleExpanded={() => setIsExpanded((current) => !current)}
          />
        </div>
      )}
    </>
  )
}
