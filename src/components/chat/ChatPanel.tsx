"use client"

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react"
import { Bot, Maximize2, Minimize2, Send, X } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import type { ChatMessage } from "@/lib/chat"

interface ChatPanelProps {
  onClose: () => void
  section?: string
  sectionLabel?: string
  isExpanded?: boolean
  onToggleExpanded?: () => void
}

type ChatDisplayMessage = ChatMessage & {
  error?: boolean
}

const suggestions = [
  "Quelles tâches cette semaine ?",
  "Quand récolter mes cultures ?",
  "Résumé de ma comptabilité",
]

function MessageMarkdown({ contenu }: { contenu: string }) {
  return (
    <div className="text-sm leading-relaxed [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_h1]:text-base [&_h1]:font-bold [&_h1]:my-2 [&_h2]:text-sm [&_h2]:font-bold [&_h2]:my-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:my-1.5 [&_strong]:font-semibold [&_em]:italic [&_code]:rounded [&_code]:bg-slate-200 [&_code]:px-1 [&_code]:text-xs [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-slate-800 [&_pre]:p-2 [&_pre]:text-xs [&_pre]:text-slate-100 [&_a]:text-emerald-700 [&_a]:underline [&_blockquote]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-2 [&_table]:my-2 [&_table]:w-full [&_table]:text-xs [&_th]:border [&_th]:border-slate-300 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-slate-300 [&_td]:px-2 [&_td]:py-1">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{contenu}</ReactMarkdown>
    </div>
  )
}

const messageErreurReseau =
  "Impossible de joindre l'assistant IA pour le moment. Vérifiez votre connexion puis réessayez."

function estObjet(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function ChatPanel({
  onClose,
  section,
  sectionLabel,
  isExpanded = false,
  onToggleExpanded,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatDisplayMessage[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isLoading])

  const ajusterHauteurTextarea = () => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.style.height = "auto"
    textarea.style.height = `${Math.min(textarea.scrollHeight, 72)}px`
  }

  const handleInputChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value)
    ajusterHauteurTextarea()
  }

  const envoyerMessage = async () => {
    const contenu = input.trim()
    if (!contenu || isLoading) return

    const messageUtilisateur: ChatMessage = { role: "user", content: contenu }
    const historique = [
      ...messages.filter((message) => !message.error),
      messageUtilisateur,
    ].map(({ role, content }) => ({ role, content }))

    setMessages((current) => [...current, messageUtilisateur])
    setInput("")
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
    setIsLoading(true)

    try {
      let response: Response
      try {
        response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: historique, section }),
        })
      } catch {
        throw new Error(messageErreurReseau)
      }

      const data: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const detail =
          estObjet(data) && typeof data.error === "string" ? data.error : "Le service est indisponible."
        throw new Error(`Erreur de l'assistant IA : ${detail}`)
      }

      if (!estObjet(data) || typeof data.reply !== "string" || data.reply.trim() === "") {
        throw new Error("Erreur de l'assistant IA : la réponse reçue est invalide.")
      }

      const reponse = data.reply
      setMessages((current) => [
        ...current,
        { role: "assistant", content: reponse },
      ])
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : messageErreurReseau
      setMessages((current) => [
        ...current,
        { role: "assistant", content: message, error: true },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void envoyerMessage()
    }
  }

  const remplirSuggestion = (suggestion: string) => {
    setInput(suggestion)
    textareaRef.current?.focus()
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border bg-white shadow-lg">
      <header className="flex shrink-0 items-center justify-between border-b bg-slate-50 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <Bot className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-slate-900">Assistant IA</h2>
            {sectionLabel && (
              <Badge variant="secondary" className="shrink-0 font-normal">
                {sectionLabel}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onToggleExpanded && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onToggleExpanded}
              aria-label={isExpanded ? "Réduire l'assistant IA" : "Agrandir l'assistant IA"}
              title={isExpanded ? "Réduire" : "Agrandir"}
            >
              {isExpanded ? (
                <Minimize2 className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onClose}
            aria-label="Fermer l'assistant IA"
            title="Fermer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-3">
          {messages.length === 0 ? (
            <div className="space-y-4 py-3">
              <p className="text-sm leading-relaxed text-slate-700">
                Bonjour ! Je suis l&apos;assistant IA de Gleba. Posez-moi une question sur vos cultures,
                votre verger, votre élevage ou votre comptabilité.
              </p>
              <div className="space-y-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="block w-full rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-left text-sm text-emerald-800 transition-colors hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                    onClick={() => remplirSuggestion(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`flex ${message.error || message.role === "assistant" ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                    message.error
                      ? "bg-amber-100 text-amber-900"
                      : message.role === "user"
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-100 text-slate-800"
                  }`}
                >
                  {message.role === "assistant" && !message.error ? (
                    <MessageMarkdown contenu={message.content} />
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
                  )}
                </div>
              </div>
            ))
          )}
          {isLoading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl bg-slate-100 px-3 py-2 text-sm text-slate-600">
                <span>L&apos;assistant réfléchit</span>
                <span className="flex gap-1" aria-hidden="true">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-500 [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-500 [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-500" />
                </span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} aria-hidden="true" />
        </div>
      </ScrollArea>

      <form
        className="flex shrink-0 items-end gap-2 border-t bg-white p-3"
        onSubmit={(event) => {
          event.preventDefault()
          void envoyerMessage()
        }}
      >
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          placeholder="Écrivez votre question…"
          aria-label="Votre question à l'assistant IA"
          rows={1}
          disabled={isLoading}
          className="min-h-0 max-h-20 resize-none overflow-y-auto py-2 text-sm"
        />
        <Button
          type="submit"
          size="icon"
          className="shrink-0 bg-emerald-600 hover:bg-emerald-700"
          disabled={isLoading || input.trim() === ""}
          aria-label="Envoyer le message"
          title="Envoyer"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </Button>
      </form>
    </div>
  )
}
