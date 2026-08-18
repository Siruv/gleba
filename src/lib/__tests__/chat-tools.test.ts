import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  cultureFindMany: vi.fn(),
  parcelleFindMany: vi.fn(),
  fetchOpenMeteoForecast: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  default: {
    culture: { findMany: mocks.cultureFindMany },
    parcelleGeo: { findMany: mocks.parcelleFindMany },
  },
}))

vi.mock("@/lib/meteo", () => ({
  fetchOpenMeteoForecast: mocks.fetchOpenMeteoForecast,
}))

import { executerOutil, outilsChat, outilsPourBackend } from "../chat-tools"

describe("outils du chat", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("retourne une erreur structurée pour un outil inconnu", async () => {
    await expect(executerOutil("outil_inconnu", "{}", "user-test")).resolves.toBe(
      JSON.stringify({ erreur: "Outil inconnu : outil_inconnu" })
    )
  })

  it("retourne un tableau compact pour get_cultures", async () => {
    mocks.cultureFindMany.mockResolvedValue([
      {
        id: 1,
        annee: 2026,
        dateSemis: new Date("2026-03-01"),
        datePlantation: null,
        dateRecolte: null,
        semisFait: true,
        plantationFaite: false,
        recolteFaite: false,
        terminee: null,
        notes: "Sous abri",
        espece: { nom: "Tomate" },
        variete: { nom: "Cœur de bœuf" },
        planche: { nom: "Planche 1" },
      },
    ])

    const resultat = JSON.parse(await executerOutil("get_cultures", "{}", "user-test")) as unknown

    expect(resultat).toEqual([
      expect.objectContaining({ espece: "Tomate", variete: "Cœur de bœuf", etat: "Semée" }),
    ])
    expect(mocks.cultureFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-test" },
      take: 50,
    }))
  })

  it("retourne la météo structurée de plusieurs parcelles", async () => {
    mocks.parcelleFindMany.mockResolvedValue([
      { id: "parcelle-1", nom: "Nord", centroidLat: 45, centroidLng: 2 },
    ])
    mocks.fetchOpenMeteoForecast.mockResolvedValue({
      current: {
        temperature: 17.6,
        humidity: 60,
        windSpeed: 10,
        weatherDescription: "Ciel dégagé",
      },
      daily: [
        {
          date: "2026-06-01",
          tempMin: 10,
          tempMax: 24,
          precipitation: 0.5,
          precipitationProba: 20,
        },
      ],
    })

    const resultat = JSON.parse(await executerOutil("get_meteo_parcelles", "{}", "user-test")) as {
      parcelles: Array<{ nom: string }>
    }

    expect(resultat.parcelles).toHaveLength(1)
    expect(resultat.parcelles[0]?.nom).toBe("Nord")
  })

  it("décrit tous les outils au format backend", () => {
    const outils = outilsPourBackend()

    expect(outils).toHaveLength(outilsChat.length)
    expect(outils.every((outil) =>
      outil.type === "function" &&
      outil.name !== "" &&
      outil.description !== "" &&
      typeof outil.parameters === "object"
    )).toBe(true)
  })
})
