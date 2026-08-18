"use client"

import * as React from "react"
import { Bot, Loader2, LogIn, LogOut, Save, Send } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import type { ModeleCodex } from "@/lib/chat-codex"

type Provenance = "db" | "env" | "defaut"
type SettingValue = boolean | number | string
type SettingDetails = {
  valeur: SettingValue
  provenance: Provenance
}
type ChatProvider = "ollama" | "openai" | "anthropic" | "custom" | "openai-codex"
type SettingKey =
  | "chat.provider"
  | "chat.model"
  | "chat.apiKey"
  | "chat.baseUrl"
  | "chat.ollamaHost"
  | "chat.codexAccessToken"
  | "chat.codexRefreshToken"
type Reglages = Record<SettingKey, SettingDetails>

const valeurMasquee = "••••••••"
const clesChat: SettingKey[] = [
  "chat.provider",
  "chat.model",
  "chat.baseUrl",
  "chat.ollamaHost",
]

const providers: Array<{ value: ChatProvider; label: string }> = [
  { value: "ollama", label: "Ollama (local)" },
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "custom", label: "Personnalisé (compatible OpenAI)" },
  { value: "openai-codex", label: "ChatGPT (compte OpenAI)" },
]

const placeholdersModeles: Record<ChatProvider, string> = {
  ollama: "glm-4.7",
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-5",
  custom: "nom du modèle",
  "openai-codex": "gpt-5.6-luna",
}

const urlsParDefaut: Record<ChatProvider, string> = {
  ollama: "http://localhost:11434",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  custom: "",
  "openai-codex": "",
}

const presetsBaseUrlCustom: Array<{ value: string; label: string }> = [
  { value: "https://openrouter.ai/api/v1", label: "OpenRouter" },
  { value: "http://localhost:1234/v1", label: "LM Studio (local)" },
  { value: "http://localhost:8000/v1", label: "vLLM (local)" },
]

const provenanceLabels: Record<Provenance, string> = {
  db: "base",
  env: "variable d'environnement",
  defaut: "défaut",
}

function extraireMessageErreur(data: unknown, messageParDefaut: string): string {
  if (
    typeof data === "object" &&
    data !== null &&
    "error" in data &&
    typeof data.error === "string"
  ) {
    return data.error
  }
  return messageParDefaut
}

function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  return (
    <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground">
      {provenanceLabels[provenance]}
    </Badge>
  )
}

function valeursEgales(gauche: SettingValue, droite: SettingValue): boolean {
  return String(gauche) === String(droite)
}

export function ReglagesChat() {
  const { toast } = useToast()
  const [reglages, setReglages] = React.useState<Reglages | null>(null)
  const [reglagesInitiaux, setReglagesInitiaux] = React.useState<Reglages | null>(null)
  const [modelesCodex, setModelesCodex] = React.useState<ModeleCodex[] | null>(null)
  const [modelesCodexChargement, setModelesCodexChargement] = React.useState(false)
  const [modeleCodexAutreSelectionne, setModeleCodexAutreSelectionne] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [erreur, setErreur] = React.useState<string | null>(null)
  const [cleApiSaisie, setCleApiSaisie] = React.useState("")
  const [codexConnexion, setCodexConnexion] = React.useState<{
    userCode: string
    deviceAuthId: string
    verificationUrl: string
  } | null>(null)
  const [codexPolling, setCodexPolling] = React.useState(false)
  const codexPollingRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const codexTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const provider = reglages ? String(reglages["chat.provider"].valeur) as ChatProvider : "ollama"
  const providerValide = providers.some((option) => option.value === provider) ? provider : "ollama"
  const codexConnecte = reglages
    ? String(reglages["chat.codexAccessToken"].valeur).trim() !== ""
    : false

  const chargerReglages = React.useCallback(async (afficherChargement = true): Promise<boolean> => {
    if (afficherChargement) setLoading(true)

    try {
      const response = await fetch("/api/admin/settings", { cache: "no-store" })
      const data: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(extraireMessageErreur(data, "Impossible de charger les réglages du chat."))
      }

      const valeurs = data as Reglages
      setReglages(valeurs)
      setReglagesInitiaux(valeurs)
      setCleApiSaisie("")
      setErreur(null)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossible de charger les réglages du chat."
      setErreur(message)
      if (afficherChargement) {
        toast({
          variant: "destructive",
          title: "Réglages non chargés",
          description: message,
        })
      }
      return false
    } finally {
      if (afficherChargement) setLoading(false)
    }
  }, [toast])

  const arreterPollingCodex = React.useCallback(() => {
    if (codexPollingRef.current) clearInterval(codexPollingRef.current)
    if (codexTimeoutRef.current) clearTimeout(codexTimeoutRef.current)
    codexPollingRef.current = null
    codexTimeoutRef.current = null
    setCodexPolling(false)
  }, [])

  React.useEffect(() => {
    void chargerReglages()
    return arreterPollingCodex
  }, [arreterPollingCodex, chargerReglages])

  React.useEffect(() => {
    if (providerValide !== "openai-codex") {
      setModelesCodex(null)
      setModelesCodexChargement(false)
      setModeleCodexAutreSelectionne(false)
      return
    }

    let annule = false
    setModelesCodexChargement(true)
    void fetch("/api/admin/chat/codex-models", { cache: "no-store" })
      .then(async (response) => {
        const data: unknown = await response.json().catch(() => null)
        if (!response.ok) throw new Error(extraireMessageErreur(data, "Impossible de charger les modèles Codex."))
        if (
          typeof data !== "object" ||
          data === null ||
          !("modeles" in data) ||
          !Array.isArray(data.modeles)
        ) {
          throw new Error("Réponse invalide du serveur des modèles Codex.")
        }
        if (!annule) setModelesCodex(data.modeles as ModeleCodex[])
      })
      .catch(() => {
        if (!annule) setModelesCodex(null)
      })
      .finally(() => {
        if (!annule) setModelesCodexChargement(false)
      })

    return () => {
      annule = true
    }
  }, [codexConnecte, providerValide])

  const demarrerConnexionCodex = async () => {
    if (codexPolling) return

    try {
      const response = await fetch("/api/admin/chat/codex-login", { method: "POST" })
      const data: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(extraireMessageErreur(data, "Impossible de démarrer la connexion à ChatGPT."))
      }
      const connexionData = data as {
        userCode?: unknown
        deviceAuthId?: unknown
        verificationUrl?: unknown
      }
      if (
        typeof data !== "object" ||
        data === null ||
        typeof connexionData.userCode !== "string" ||
        typeof connexionData.deviceAuthId !== "string" ||
        typeof connexionData.verificationUrl !== "string"
      ) {
        throw new Error("Réponse invalide du serveur de connexion à ChatGPT.")
      }
      const connexion = {
        userCode: connexionData.userCode,
        deviceAuthId: connexionData.deviceAuthId,
        verificationUrl: connexionData.verificationUrl,
      }
      setCodexConnexion(connexion)
      setCodexPolling(true)
      codexPollingRef.current = setInterval(() => {
        void (async () => {
          try {
            const responsePoll = await fetch("/api/admin/chat/codex-login/poll", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                deviceAuthId: connexion.deviceAuthId,
                userCode: connexion.userCode,
              }),
            })
            const dataPoll: unknown = await responsePoll.json().catch(() => null)
            if (!responsePoll.ok) {
              throw new Error(extraireMessageErreur(dataPoll, "Impossible de vérifier la connexion à ChatGPT."))
            }
            if (
              typeof dataPoll === "object" &&
              dataPoll !== null &&
              "status" in dataPoll &&
              dataPoll.status === "connected"
            ) {
              arreterPollingCodex()
              setCodexConnexion(null)
              await chargerReglages(false)
              toast({ title: "Connecté à ChatGPT !" })
            }
          } catch (error) {
            arreterPollingCodex()
            toast({
              variant: "destructive",
              title: "Échec de la connexion à ChatGPT",
              description: error instanceof Error ? error.message : "Impossible de vérifier la connexion à ChatGPT.",
            })
          }
        })()
      }, 5_000)
      codexTimeoutRef.current = setTimeout(() => {
        arreterPollingCodex()
        toast({
          variant: "destructive",
          title: "Délai dépassé",
          description: "Réessayez.",
        })
      }, 5 * 60_000)
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Échec de la connexion à ChatGPT",
        description: error instanceof Error ? error.message : "Impossible de démarrer la connexion à ChatGPT.",
      })
    }
  }

  const annulerConnexionCodex = () => {
    arreterPollingCodex()
    setCodexConnexion(null)
  }

  const deconnecterCodex = async () => {
    arreterPollingCodex()
    try {
      const response = await fetch("/api/admin/chat/codex-logout", { method: "POST" })
      const data: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(extraireMessageErreur(data, "Impossible de déconnecter ChatGPT."))
      }
      await chargerReglages(false)
      toast({ title: "Déconnecté de ChatGPT" })
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Échec de la déconnexion",
        description: error instanceof Error ? error.message : "Impossible de déconnecter ChatGPT.",
      })
    }
  }

  const modifierValeur = (cle: SettingKey, valeur: SettingValue) => {
    setReglages((precedent) => {
      if (!precedent) return precedent
      return {
        ...precedent,
        [cle]: { ...precedent[cle], valeur },
      }
    })
  }

  const enregistrer = async () => {
    if (!reglages || !reglagesInitiaux) return

    const provider = String(reglages["chat.provider"].valeur) as ChatProvider
    const baseUrl = String(reglages["chat.baseUrl"].valeur).trim()
    if (provider === "custom" && baseUrl === "") {
      toast({
        variant: "destructive",
        title: "Réglages invalides",
        description: "L'URL de base est obligatoire pour le provider personnalisé.",
      })
      return
    }

    const apiKeyInitialisee =
      reglagesInitiaux["chat.apiKey"].valeur === valeurMasquee ||
      String(reglagesInitiaux["chat.apiKey"].valeur).trim() !== ""
    const providerSansCleApi = provider === "ollama" || provider === "openai-codex"
    if (!providerSansCleApi && cleApiSaisie.trim() === "" && !apiKeyInitialisee) {
      toast({
        variant: "destructive",
        title: "Réglages invalides",
        description: "Une clé API est obligatoire pour ce provider.",
      })
      return
    }

    const clesModifiees = clesChat.filter((cle) =>
      !valeursEgales(reglages[cle].valeur, reglagesInitiaux[cle].valeur)
    )
    if (clesModifiees.length === 0 && cleApiSaisie.trim() === "") {
      toast({ title: "Aucune modification à enregistrer" })
      return
    }

    setSaving(true)
    try {
      for (const cle of clesModifiees) {
        const response = await fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cle, valeur: reglages[cle].valeur }),
        })
        const data: unknown = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(extraireMessageErreur(data, "Impossible d'enregistrer les réglages du chat."))
        }
      }

      if (cleApiSaisie.trim() !== "") {
        const response = await fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cle: "chat.apiKey", valeur: cleApiSaisie }),
        })
        const data: unknown = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(extraireMessageErreur(data, "Impossible d'enregistrer la clé API."))
        }
      }

      if (await chargerReglages(false)) {
        toast({ title: "Réglages du chat enregistrés" })
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Échec de l'enregistrement",
        description: error instanceof Error ? error.message : "Impossible d'enregistrer les réglages du chat.",
      })
    } finally {
      setSaving(false)
    }
  }

  const testerConnexion = async () => {
    setTesting(true)
    try {
      const response = await fetch("/api/chat/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      const data: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(extraireMessageErreur(data, "Impossible de tester la connexion au chat."))
      }
      const reponse =
        typeof data === "object" && data !== null && "reponse" in data && typeof data.reponse === "string"
          ? data.reponse
          : "Connexion établie."
      toast({ title: "Connexion au chat IA réussie", description: reponse })
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Échec du test",
        description: error instanceof Error ? error.message : "Impossible de tester la connexion au chat.",
      })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6" aria-live="polite" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[32rem] w-full" />
        <span className="sr-only">Chargement…</span>
      </div>
    )
  }

  if (!reglages) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <p className="text-sm text-muted-foreground">{erreur || "Impossible de charger les réglages."}</p>
          <Button onClick={() => void chargerReglages()}>Réessayer</Button>
        </CardContent>
      </Card>
    )
  }

  const modeleActuel = String(reglages["chat.model"].valeur)
  const modeleCodexSlugs = modelesCodex?.map((modele) => modele.slug) ?? []
  const modeleCodexEstAutre =
    modeleCodexAutreSelectionne ||
    (modeleActuel.trim() !== "" && !modeleCodexSlugs.includes(modeleActuel))
  const baseUrl = String(reglages["chat.baseUrl"].valeur)
  const presetBaseUrlCustom = presetsBaseUrlCustom.some((preset) => preset.value === baseUrl)
    ? baseUrl
    : "autre"

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-amber-900">Réglages du chat IA</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configurez le provider utilisé par l&apos;assistant conversationnel de Gleba.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-amber-600" />
            Chat IA (multi-providers)
          </CardTitle>
          <CardDescription>
            Choisissez un service local ou distant pour répondre aux utilisateurs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="chat-provider">Provider</Label>
              <ProvenanceBadge provenance={reglages["chat.provider"].provenance} />
            </div>
            <Select
              value={providerValide}
              onValueChange={(value) => {
                if (value !== providerValide) {
                  modifierValeur("chat.model", "")
                }
                if (value !== "openai-codex") {
                  arreterPollingCodex()
                  setCodexConnexion(null)
                }
                modifierValeur("chat.provider", value as ChatProvider)
              }}
              disabled={saving || testing || codexPolling}
            >
              <SelectTrigger id="chat-provider">
                <SelectValue placeholder="Choisir un provider" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="chat-model">Modèle</Label>
              <ProvenanceBadge provenance={reglages["chat.model"].provenance} />
            </div>
            {providerValide === "openai-codex" && modelesCodexChargement ? (
              <p className="text-sm text-muted-foreground">Chargement des modèles disponibles…</p>
            ) : providerValide === "openai-codex" && modelesCodex && modelesCodex.length > 0 ? (
              <div className="space-y-2">
                <Select
                  value={modeleCodexEstAutre ? "autre" : modeleActuel}
                  onValueChange={(value) => {
                    if (value === "autre") {
                      setModeleCodexAutreSelectionne(true)
                    } else {
                      setModeleCodexAutreSelectionne(false)
                      modifierValeur("chat.model", value)
                    }
                  }}
                  disabled={saving || testing}
                >
                  <SelectTrigger id="chat-model">
                    <SelectValue placeholder="Choisir un modèle" />
                  </SelectTrigger>
                  <SelectContent>
                    {modelesCodex.map((modele) => {
                      const description = modele.description.length > 60
                        ? `${modele.description.slice(0, 60)}…`
                        : modele.description
                      return (
                        <SelectItem key={modele.slug} value={modele.slug}>
                          {`${modele.displayName} — ${description}`}
                        </SelectItem>
                      )
                    })}
                    <SelectItem value="autre">Autre modèle (saisir manuellement)</SelectItem>
                  </SelectContent>
                </Select>
                {modeleCodexEstAutre && (
                  <Input
                    id="chat-model-autre"
                    type="text"
                    placeholder={placeholdersModeles[providerValide]}
                    value={modeleActuel}
                    onChange={(event) => modifierValeur("chat.model", event.target.value)}
                    disabled={saving || testing}
                  />
                )}
              </div>
            ) : (
              <Input
                id="chat-model"
                type="text"
                placeholder={placeholdersModeles[providerValide]}
                value={modeleActuel}
                onChange={(event) => modifierValeur("chat.model", event.target.value)}
                disabled={saving || testing}
              />
            )}
            <p className="text-sm text-muted-foreground">
              {providerValide === "openai-codex"
                ? "Modèles disponibles avec un compte ChatGPT : gpt-5.6-luna (fonctionne aussi avec un compte gratuit), gpt-5.5."
                : "Laissez vide pour utiliser le modèle par défaut du provider (sauf personnalisé)."}
            </p>
          </div>

          {providerValide !== "ollama" && providerValide !== "openai-codex" && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor="chat-api-key">Clé API</Label>
                <ProvenanceBadge provenance={reglages["chat.apiKey"].provenance} />
              </div>
              <Input
                id="chat-api-key"
                type="password"
                placeholder={
                  reglages["chat.apiKey"].valeur === valeurMasquee
                    ? "•••••••• (configuré)"
                    : "Clé API du provider"
                }
                value={cleApiSaisie}
                onChange={(event) => setCleApiSaisie(event.target.value)}
                disabled={saving || testing}
              />
              <p className="text-sm text-muted-foreground">Inutile pour Ollama.</p>
            </div>
          )}

          {providerValide !== "ollama" && providerValide !== "openai-codex" && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor="chat-base-url">URL de base</Label>
                <ProvenanceBadge provenance={reglages["chat.baseUrl"].provenance} />
              </div>
              {providerValide === "custom" && (
                <div className="space-y-2">
                  <Label htmlFor="chat-base-url-preset">Préréglages</Label>
                  <Select
                    value={presetBaseUrlCustom}
                    onValueChange={(value) => {
                      if (value !== "autre") modifierValeur("chat.baseUrl", value)
                    }}
                    disabled={saving || testing}
                  >
                    <SelectTrigger id="chat-base-url-preset">
                      <SelectValue placeholder="Préréglages" />
                    </SelectTrigger>
                    <SelectContent>
                      {presetsBaseUrlCustom.map((preset) => (
                        <SelectItem key={preset.value} value={preset.value}>
                          {preset.label}
                        </SelectItem>
                      ))}
                      <SelectItem value="autre">Autre (saisir l&apos;URL)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Input
                id="chat-base-url"
                type="text"
                placeholder={urlsParDefaut[providerValide]}
                value={baseUrl}
                onChange={(event) => modifierValeur("chat.baseUrl", event.target.value)}
                disabled={saving || testing}
              />
              <p className="text-sm text-muted-foreground">
                {providerValide === "custom"
                  ? "Adresse d'un point d'entrée compatible OpenAI (OpenRouter, LM Studio, vLLM…)."
                  : `Laissez vide pour utiliser l'URL par défaut : ${urlsParDefaut[providerValide]}`}
              </p>
            </div>
          )}

          {providerValide === "openai-codex" && (
            <div className="space-y-4 rounded-md border border-amber-200 bg-amber-50/50 p-4">
              {codexConnecte ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="bg-green-600 text-white hover:bg-green-600">
                      Connecté à ChatGPT
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      Les tokens sont stockés de façon sécurisée.
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => void deconnecterCodex()}
                    disabled={saving || testing || codexPolling}
                  >
                    <LogOut className="h-4 w-4" />
                    Se déconnecter
                  </Button>
                </div>
              ) : codexConnexion ? (
                <div className="space-y-3" aria-live="polite">
                  <p className="text-sm">
                    Ouvrez cette page dans votre navigateur :{" "}
                    <a
                      href={codexConnexion.verificationUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-amber-800 underline"
                    >
                      {codexConnexion.verificationUrl}
                    </a>
                  </p>
                  <p className="text-sm">
                    Entrez le code : <strong>{codexConnexion.userCode}</strong>
                  </p>
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    En attente de validation…
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={annulerConnexionCodex}
                    disabled={!codexPolling}
                  >
                    Annuler
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm">
                    Connectez-vous avec votre compte ChatGPT (abonnement Plus, Pro ou Team requis).
                    Aucune clé API nécessaire.
                  </p>
                  <Button
                    type="button"
                    onClick={() => void demarrerConnexionCodex()}
                    disabled={saving || testing || codexPolling}
                  >
                    <LogIn className="h-4 w-4" />
                    Se connecter à ChatGPT
                  </Button>
                </div>
              )}
              <p className="text-sm text-amber-800">
                Ce provider utilise des endpoints internes d&apos;OpenAI liés à votre abonnement ChatGPT.
                Il peut cesser de fonctionner si OpenAI modifie ses services.
              </p>
            </div>
          )}

          {providerValide === "ollama" && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor="chat-ollama-host">Hôte Ollama</Label>
                <ProvenanceBadge provenance={reglages["chat.ollamaHost"].provenance} />
              </div>
              <Input
                id="chat-ollama-host"
                type="text"
                placeholder={urlsParDefaut.ollama}
                value={String(reglages["chat.ollamaHost"].valeur) || urlsParDefaut.ollama}
                onChange={(event) => modifierValeur("chat.ollamaHost", event.target.value)}
                disabled={saving || testing}
              />
              <p className="text-sm text-muted-foreground">
                Adresse du serveur Ollama. Depuis Docker, utilisez l&apos;adresse IP de la machine hôte
                (pas localhost).
              </p>
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={() => void enregistrer()} disabled={saving || testing}>
              <Save className="h-4 w-4" />
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>

          <div className="space-y-4 border-t pt-6">
            <div className="space-y-1">
              <h3 className="text-sm font-medium">Test</h3>
              <p className="text-sm text-muted-foreground">
                Vérifiez que la configuration permet de joindre le provider sélectionné.
              </p>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => void testerConnexion()}
                disabled={testing || saving}
              >
                <Send className="h-4 w-4" />
                {testing ? "Test en cours…" : "Tester la connexion"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
