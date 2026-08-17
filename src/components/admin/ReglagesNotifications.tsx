"use client"

import * as React from "react"
import { Bell, CloudSun, Save } from "lucide-react"
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
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"

type Provenance = "db" | "env" | "defaut"
type SettingValue = boolean | number | string
type SettingDetails = {
  valeur: SettingValue
  provenance: Provenance
}

type SettingKey =
  | "notif.enabled"
  | "notif.resumeHeure"
  | "notif.meteoIntervalMin"
  | "notif.timezone"
  | "seuil.gel"
  | "seuil.canicule"
  | "seuil.ventFort"
  | "seuil.pluieAbondante"
type Reglages = Record<SettingKey, SettingDetails>

const clesNotifications: SettingKey[] = [
  "notif.enabled",
  "notif.resumeHeure",
  "notif.meteoIntervalMin",
  "notif.timezone",
]

const clesSeuils: SettingKey[] = [
  "seuil.gel",
  "seuil.canicule",
  "seuil.ventFort",
  "seuil.pluieAbondante",
]

const fuseauxHoraires = [
  "Europe/Paris",
  "Europe/Brussels",
  "Europe/Geneva",
  "Europe/London",
  "Europe/Madrid",
  "America/Montreal",
  "America/Toronto",
  "America/New_York",
  "UTC",
]

const champsSeuils = [
  {
    cle: "seuil.gel",
    label: "Gel",
    unite: "°C",
    description: "Alerte si température minimale ≤ ce seuil",
  },
  {
    cle: "seuil.canicule",
    label: "Canicule",
    unite: "°C",
    description: "Alerte si température maximale ≥ ce seuil",
  },
  {
    cle: "seuil.ventFort",
    label: "Vent fort",
    unite: "km/h",
    description: "Alerte si rafales ≥ ce seuil",
  },
  {
    cle: "seuil.pluieAbondante",
    label: "Pluie abondante",
    unite: "mm/jour",
    description: "Alerte si précipitations ≥ ce seuil",
  },
] as const

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

function validerReglages(reglages: Reglages, cles: SettingKey[]): string | null {
  for (const cle of cles) {
    const valeur = reglages[cle].valeur

    if (cle === "notif.resumeHeure") {
      if (typeof valeur !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(valeur)) {
        return "L'heure du résumé doit être au format HH:MM."
      }
    }

    if (cle === "notif.meteoIntervalMin") {
      const intervalle = typeof valeur === "number" ? valeur : Number(valeur)
      if (!Number.isInteger(intervalle) || intervalle < 5 || intervalle > 1440) {
        return "La fréquence météo doit être un nombre entier entre 5 et 1440 minutes."
      }
    }

    if (clesSeuils.includes(cle)) {
      const seuil = typeof valeur === "number" ? valeur : Number(valeur)
      if (typeof valeur === "string" && valeur.trim() === "") {
        return "Les seuils météo doivent être des nombres valides."
      }
      if (!Number.isFinite(seuil)) {
        return "Les seuils météo doivent être des nombres valides."
      }
    }
  }

  return null
}

export function ReglagesNotifications() {
  const { toast } = useToast()
  const [reglages, setReglages] = React.useState<Reglages | null>(null)
  const [reglagesInitiaux, setReglagesInitiaux] = React.useState<Reglages | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState<"notifications" | "seuils" | null>(null)
  const [erreur, setErreur] = React.useState<string | null>(null)

  const chargerReglages = React.useCallback(async (afficherChargement = true): Promise<boolean> => {
    if (afficherChargement) setLoading(true)

    try {
      const response = await fetch("/api/admin/settings", { cache: "no-store" })
      const data: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(extraireMessageErreur(data, "Impossible de charger les réglages."))
      }

      const valeurs = data as Reglages
      setReglages(valeurs)
      setReglagesInitiaux(valeurs)
      setErreur(null)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossible de charger les réglages."
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

  React.useEffect(() => {
    void chargerReglages()
  }, [chargerReglages])

  const modifierValeur = (cle: SettingKey, valeur: SettingValue) => {
    setReglages((precedent) => {
      if (!precedent) return precedent
      return {
        ...precedent,
        [cle]: { ...precedent[cle], valeur },
      }
    })
  }

  const enregistrer = async (
    groupe: "notifications" | "seuils",
    cles: SettingKey[]
  ) => {
    if (!reglages || !reglagesInitiaux) return

    const messageValidation = validerReglages(reglages, cles)
    if (messageValidation) {
      toast({
        variant: "destructive",
        title: "Réglages invalides",
        description: messageValidation,
      })
      return
    }

    const clesModifiees = cles.filter((cle) =>
      !valeursEgales(reglages[cle].valeur, reglagesInitiaux[cle].valeur)
    )
    if (clesModifiees.length === 0) {
      toast({ title: "Aucune modification à enregistrer" })
      return
    }

    setSaving(groupe)
    try {
      for (const cle of clesModifiees) {
        const response = await fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cle, valeur: reglages[cle].valeur }),
        })
        const data: unknown = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(extraireMessageErreur(data, "Impossible d'enregistrer les réglages."))
        }
      }

      const actualises = await chargerReglages(false)
      if (actualises) {
        toast({ title: "Réglages enregistrés" })
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Échec de l'enregistrement",
        description: error instanceof Error ? error.message : "Impossible d'enregistrer les réglages.",
      })
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6" aria-live="polite" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
        <span className="sr-only">Chargement…</span>
      </div>
    )
  }

  if (!reglages) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <p className="text-sm text-muted-foreground">{erreur || "Impossible de charger les réglages."}</p>
          <Button onClick={() => void chargerReglages()}>
            Réessayer
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-amber-900">Réglages des notifications</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configurez les notifications globales et les seuils des alertes météo.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-amber-600" />
            Notifications
          </CardTitle>
          <CardDescription>
            Paramètres du résumé quotidien et de la surveillance météo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor="notif-enabled">Activer les notifications</Label>
                <ProvenanceBadge provenance={reglages["notif.enabled"].provenance} />
              </div>
              <p id="notif-enabled-description" className="text-sm text-muted-foreground">
                Coupe l&apos;ensemble des envois (résumé quotidien, météo, alertes urgentes)
              </p>
            </div>
            <Switch
              id="notif-enabled"
              checked={reglages["notif.enabled"].valeur === true}
              onCheckedChange={(value) => modifierValeur("notif.enabled", value)}
              aria-describedby="notif-enabled-description"
              disabled={saving !== null}
            />
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="notif-resume-heure">Heure du résumé quotidien</Label>
              <ProvenanceBadge provenance={reglages["notif.resumeHeure"].provenance} />
            </div>
            <Input
              id="notif-resume-heure"
              type="time"
              value={String(reglages["notif.resumeHeure"].valeur)}
              onChange={(event) => modifierValeur("notif.resumeHeure", event.target.value)}
              disabled={saving !== null}
            />
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="notif-meteo-interval">Fréquence de surveillance météo</Label>
              <ProvenanceBadge provenance={reglages["notif.meteoIntervalMin"].provenance} />
            </div>
            <div className="flex items-center gap-2">
              <Input
                id="notif-meteo-interval"
                type="number"
                min={5}
                max={1440}
                value={String(reglages["notif.meteoIntervalMin"].valeur)}
                onChange={(event) => modifierValeur("notif.meteoIntervalMin", event.target.value)}
                disabled={saving !== null}
              />
              <span className="shrink-0 text-sm text-muted-foreground">minutes</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Fréquence du scan météo temps réel et des alertes urgentes (entre 5 et 1440 min)
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="notif-timezone">Fuseau horaire</Label>
              <ProvenanceBadge provenance={reglages["notif.timezone"].provenance} />
            </div>
            <Select
              value={String(reglages["notif.timezone"].valeur)}
              onValueChange={(value) => modifierValeur("notif.timezone", value)}
              disabled={saving !== null}
            >
              <SelectTrigger id="notif-timezone">
                <SelectValue placeholder="Choisir un fuseau horaire" />
              </SelectTrigger>
              <SelectContent>
                {fuseauxHoraires.map((fuseau) => (
                  <SelectItem key={fuseau} value={fuseau}>
                    {fuseau}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              Fuseau utilisé pour l&apos;heure du résumé quotidien
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => void enregistrer("notifications", clesNotifications)}
              disabled={saving !== null}
            >
              <Save className="h-4 w-4" />
              {saving === "notifications" ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CloudSun className="h-5 w-5 text-sky-600" />
            Seuils d&apos;alerte météo
          </CardTitle>
          <CardDescription>
            Définissez les seuils à partir desquels une alerte météo est déclenchée.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            {champsSeuils.map((champ) => (
              <div key={champ.cle} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor={champ.cle}>{champ.label}</Label>
                  <ProvenanceBadge provenance={reglages[champ.cle].provenance} />
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    id={champ.cle}
                    type="number"
                    value={String(reglages[champ.cle].valeur)}
                    onChange={(event) => modifierValeur(champ.cle, event.target.value)}
                    disabled={saving !== null}
                  />
                  <span className="shrink-0 text-sm text-muted-foreground">{champ.unite}</span>
                </div>
                <p className="text-sm text-muted-foreground">{champ.description}</p>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => void enregistrer("seuils", clesSeuils)}
              disabled={saving !== null}
            >
              <Save className="h-4 w-4" />
              {saving === "seuils" ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
