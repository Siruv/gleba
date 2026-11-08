import { describe, expect, it } from "vitest"
import type { AlerteUrgente, TacheJour } from "@/lib/notifications/types"
import {
  briefingEstVide,
  compteur,
  dedoublonnerAlertes,
  formaterDateFr,
  libelleTache,
  varieteEstRedondante,
  type BriefingPayload,
} from "./daily-briefing"

const vide: BriefingPayload = { taches: [], alertesMeteo: [], alertesUrgentes: [] }

describe("briefingEstVide", () => {
  it("est vrai sans tâche ni alerte", () => {
    expect(briefingEstVide(vide)).toBe(true)
  })
  it("est faux dès qu'une tâche, une alerte urgente ou une alerte météo existe", () => {
    expect(briefingEstVide({ ...vide, taches: [{} as never] })).toBe(false)
    expect(briefingEstVide({ ...vide, alertesUrgentes: [{} as never] })).toBe(false)
    expect(briefingEstVide({ ...vide, alertesMeteo: [{} as never] })).toBe(false)
  })
  it("traite l'absence de données comme vide", () => {
    expect(briefingEstVide(null)).toBe(true)
  })
})

const lundi = new Date(2026, 10, 2, 9, 30)

describe("formaterDateFr", () => {
  it("dit aujourd'hui, demain, hier", () => {
    expect(formaterDateFr("2026-11-02T00:00:00.000Z", lundi)).toBe("aujourd'hui")
    expect(formaterDateFr("2026-11-03", lundi)).toBe("demain")
    expect(formaterDateFr("2026-11-01", lundi)).toBe("hier")
  })
  it("écrit les autres jours en toutes lettres, jamais en ISO", () => {
    expect(formaterDateFr("2026-11-08T00:00:00.000Z", lundi)).toBe("dimanche 8 novembre")
    expect(formaterDateFr("2027-01-04", lundi)).toBe("lundi 4 janvier 2027")
  })
  it("lit un minuit local comme son jour civil local", () => {
    expect(formaterDateFr(new Date(2026, 10, 9), lundi)).toBe("lundi 9 novembre")
  })
  it("renvoie une chaîne vide si illisible", () => {
    expect(formaterDateFr("n'importe quoi", lundi)).toBe("")
  })
})

describe("varieteEstRedondante", () => {
  it("détecte le placeholder et le nom commençant par l'espèce", () => {
    expect(varieteEstRedondante("Chou brocoli", "Chou brocoli — Non spécifiée")).toBe(true)
    expect(varieteEstRedondante("Chou brocoli", "chou brocoli - non specifiee")).toBe(true)
    expect(varieteEstRedondante("Tomate", "Tomate cerise")).toBe(true)
    expect(varieteEstRedondante("Tomate", null)).toBe(true)
  })
  it("garde une vraie variété", () => {
    expect(varieteEstRedondante("Tomate", "Cœur de bœuf")).toBe(false)
  })
})

const tache = (p: Partial<TacheJour>): TacheJour => ({
  id: 1, type: "semis", especeNom: "Chou brocoli", varieteNom: null, plancheName: "A1",
  ilot: null, date: "2026-11-08T00:00:00.000Z", fait: false, couleur: null, ...p,
})

describe("libelleTache", () => {
  it("compose un libellé propre avec la planche", () => {
    expect(libelleTache(tache({ varieteNom: "Chou brocoli — Non spécifiée" }))).toBe("Semis de Chou brocoli, planche A1")
    expect(libelleTache(tache({ type: "recolte", especeNom: "Tomate", varieteNom: "Cœur de bœuf", plancheName: null })))
      .toBe("Récolte de Tomate (Cœur de bœuf)")
    expect(libelleTache(tache({ type: "plantation" }))).toBe("Plantation de Chou brocoli, planche A1")
  })
})

describe("compteur", () => {
  it("accorde au pluriel", () => {
    expect(compteur(1, "tâche")).toBe("1 tâche")
    expect(compteur(3, "tâche")).toBe("3 tâches")
  })
})

const alerte = (message: string, type: AlerteUrgente["type"] = "tache-itp-semaine"): AlerteUrgente => ({
  type, titre: "t", message, key: "k",
})

describe("dedoublonnerAlertes", () => {
  const msg = "Cette semaine (du 02/11/2026 au 08/11/2026) : Semer Chou brocoli (planche A1)."
  it("masque l'alerte de semaine qui répète une tâche du jour", () => {
    expect(dedoublonnerAlertes([tache({})], [alerte(msg)])).toEqual([])
  })
  it("garde l'alerte si la planche ou le type diffère", () => {
    expect(dedoublonnerAlertes([tache({ plancheName: "B2" })], [alerte(msg)])).toHaveLength(1)
    expect(dedoublonnerAlertes([tache({ type: "recolte" })], [alerte(msg)])).toHaveLength(1)
  })
  it("garde l'alerte si un seul élément n'est pas couvert ou si elle est tronquée", () => {
    const deux = "Cette semaine (du 02/11/2026 au 08/11/2026) : Semer Chou brocoli (planche A1), Poireau."
    expect(dedoublonnerAlertes([tache({})], [alerte(deux)])).toHaveLength(1)
    const tronque = "Cette semaine (du 02/11/2026 au 08/11/2026) : Semer Chou brocoli (planche A1)… et 2 autres."
    expect(dedoublonnerAlertes([tache({})], [alerte(tronque)])).toHaveLength(1)
  })
  it("ne touche jamais aux autres types d'alerte", () => {
    expect(dedoublonnerAlertes([tache({})], [alerte(msg, "tache-retard")])).toHaveLength(1)
  })
})
