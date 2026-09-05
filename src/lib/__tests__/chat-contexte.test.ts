import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  parcelleFindMany: vi.fn(),
  fetchOpenMeteoForecast: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  default: {
    parcelleGeo: {
      findMany: mocks.parcelleFindMany,
    },
  },
}))

vi.mock("@/lib/meteo", () => ({
  fetchOpenMeteoForecast: mocks.fetchOpenMeteoForecast,
}))

import { construireContexteMeteo } from "../chat-contexte"

describe("contexte météo du chat", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("retourne null quand l'utilisateur n'a pas de parcelle géolocalisée", async () => {
    mocks.parcelleFindMany.mockResolvedValue([])

    await expect(construireContexteMeteo("user-test")).resolves.toBeNull()
  })

  it("concatène la météo de toutes les parcelles récupérées", async () => {
    mocks.parcelleFindMany.mockResolvedValue([
      { id: "parcelle-nord", nom: "Parcelle Nord", centroidLat: 45.12, centroidLng: 2.34 },
      { id: "parcelle-sud", nom: "Parcelle Sud", centroidLat: 44.12, centroidLng: 1.34 },
    ])
    mocks.fetchOpenMeteoForecast.mockResolvedValue({
      current: {
        temperature: 18.4,
        humidity: 62,
        windSpeed: 12,
        windDirection: 180,
        precipitation: 0,
        weatherCode: 1,
        weatherDescription: "Principalement dégagé",
      },
      daily: [
        {
          date: "2026-06-01",
          tempMin: 11.2,
          tempMax: 24.8,
          tempMoy: 18,
          precipitation: 1.26,
          precipitationProba: 30,
          et0: 3,
          radiation: 10,
          sunshine: 8,
          humidityMin: 40,
          humidityMax: 75,
          windSpeedMax: 20,
        },
      ],
    })

    const contexte = await construireContexteMeteo("user-test")

    expect(contexte).toContain("Parcelle Nord")
    expect(contexte).toContain("18°C")
    expect(contexte).toContain("- 2026-06-01 : 11°C / 25°C, précipitations 1.3 mm (probabilité 30%)")
    expect(contexte).toContain("Parcelle Nord")
    expect(contexte).toContain("Parcelle Sud")
    expect(mocks.fetchOpenMeteoForecast).toHaveBeenCalledTimes(2)
  })

  it("conserve les autres parcelles si une récupération météo échoue", async () => {
    mocks.parcelleFindMany.mockResolvedValue([
      { id: "parcelle-nord", nom: "Parcelle Nord", centroidLat: 45.12, centroidLng: 2.34 },
      { id: "parcelle-sud", nom: "Parcelle Sud", centroidLat: 44.12, centroidLng: 1.34 },
    ])
    mocks.fetchOpenMeteoForecast
      .mockRejectedValueOnce(new Error("Open-Meteo indisponible"))
      .mockResolvedValueOnce({ current: null, daily: [] })

    const contexte = await construireContexteMeteo("user-test")

    expect(contexte).toContain("Parcelle Sud")
    expect(contexte).not.toContain("Parcelle Nord")
  })
})
