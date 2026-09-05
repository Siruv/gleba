import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  interventionCreate: vi.fn(),
  cultureCreate: vi.fn(),
  cultureFindFirst: vi.fn(),
  cultureUpdate: vi.fn(),
  especeFindMany: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  default: {
    intervention: { create: mocks.interventionCreate },
    culture: {
      create: mocks.cultureCreate,
      findFirst: mocks.cultureFindFirst,
      update: mocks.cultureUpdate,
    },
    espece: { findMany: mocks.especeFindMany },
  },
}))

import { executerOutil, outilsChat } from "../chat-tools"

describe("outils d'écriture du chat", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("create_intervention", () => {
    it("crée une intervention avec un type valide", async () => {
      mocks.interventionCreate.mockResolvedValue({
        id: 1,
        type: "arrosage",
        description: "Arroser les tomates",
        date: new Date("2026-08-20"),
        fait: true,
      })

      const resultat = JSON.parse(await executerOutil(
        "create_intervention",
        JSON.stringify({ type: "arrosage", description: "Arroser les tomates" }),
        "user-test"
      ))

      expect(resultat).toEqual({
        succes: true,
        message: expect.stringContaining("Intervention \"arrosage\" créée"),
        intervention: expect.objectContaining({ type: "arrosage" }),
      })
    })

    it("retourne une erreur pour un type invalide", async () => {
      const resultat = JSON.parse(await executerOutil(
        "create_intervention",
        JSON.stringify({ type: "bidon" }),
        "user-test"
      ))

      expect(resultat).toEqual({
        erreur: expect.stringContaining("Type d'intervention invalide"),
      })
      expect(resultat.succes).toBeUndefined()
    })
  })

  describe("create_culture", () => {
    it("retourne une erreur sans especeNom ni especeId", async () => {
      const resultat = JSON.parse(await executerOutil(
        "create_culture",
        JSON.stringify({}),
        "user-test"
      ))

      expect(resultat).toEqual({
        erreur: "Indiquez l'espèce (especeNom ou especeId).",
      })
    })

    it("retourne une erreur si aucune espèce n'est trouvée", async () => {
      mocks.especeFindMany.mockResolvedValue([])

      const resultat = JSON.parse(await executerOutil(
        "create_culture",
        JSON.stringify({ especeNom: "espece_inexistante" }),
        "user-test"
      ))

      expect(resultat).toEqual({
        erreur: expect.stringContaining("Aucune espèce trouvée"),
      })
    })

    it("crée une culture avec un especeNom valide", async () => {
      mocks.especeFindMany.mockResolvedValue([
        { id: "espece-1", nom: "Tomate", userId: "user-test" },
      ])
      mocks.cultureCreate.mockResolvedValue({
        id: 1,
        especeId: "espece-1",
        annee: 2026,
        semisFait: false,
        espece: { nom: "Tomate" },
      })

      const resultat = JSON.parse(await executerOutil(
        "create_culture",
        JSON.stringify({ especeNom: "Tomate", annee: 2026 }),
        "user-test"
      ))

      expect(resultat).toEqual({
        succes: true,
        message: expect.stringContaining("Culture \"Tomate\" créée"),
        culture: expect.objectContaining({ espece: "Tomate" }),
      })
    })
  })

  describe("update_culture", () => {
    it("retourne une erreur avec un cultureId invalide", async () => {
      const resultat = JSON.parse(await executerOutil(
        "update_culture",
        JSON.stringify({ cultureId: 0 }),
        "user-test"
      ))

      expect(resultat).toEqual({
        erreur: "cultureId invalide.",
      })
    })

    it("retourne une erreur si la culture n'appartient pas à l'utilisateur", async () => {
      mocks.cultureFindFirst.mockResolvedValue(null)

      const resultat = JSON.parse(await executerOutil(
        "update_culture",
        JSON.stringify({ cultureId: 999, semisFait: true }),
        "user-test"
      ))

      expect(resultat).toEqual({
        erreur: "Culture 999 introuvable ou n'appartient pas à l'utilisateur.",
      })
    })

    it("retourne une erreur si aucun champ à mettre à jour", async () => {
      mocks.cultureFindFirst.mockResolvedValue({ id: 1, userId: "user-test" })

      const resultat = JSON.parse(await executerOutil(
        "update_culture",
        JSON.stringify({ cultureId: 1 }),
        "user-test"
      ))

      expect(resultat).toEqual({
        erreur: "Aucun champ à mettre à jour.",
      })
    })

    it("met à jour une culture avec succès", async () => {
      mocks.cultureFindFirst.mockResolvedValue({ id: 1, userId: "user-test" })
      mocks.cultureUpdate.mockResolvedValue({
        id: 1,
        especeId: "espece-1",
        semisFait: true,
        espece: { nom: "Tomate" },
      })

      const resultat = JSON.parse(await executerOutil(
        "update_culture",
        JSON.stringify({ cultureId: 1, semisFait: true }),
        "user-test"
      ))

      expect(resultat).toEqual({
        succes: true,
        message: "Culture \"Tomate\" (id 1) mise à jour.",
        culture: expect.objectContaining({ semisFait: true }),
      })
    })
  })

  it("trouve les outils d'écriture dans la liste", () => {
    const outilsEcriture = outilsChat.filter((outil) => 
      ["create_intervention", "create_culture", "update_culture"].includes(outil.name)
    )
    expect(outilsEcriture).toHaveLength(3)
  })
})
