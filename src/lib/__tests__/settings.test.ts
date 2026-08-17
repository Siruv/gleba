import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  parametreFindUnique: vi.fn(),
  parametreUpsert: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  default: {
    parametre: {
      findUnique: mocks.parametreFindUnique,
      upsert: mocks.parametreUpsert,
    },
  },
}))

import prisma from "@/lib/prisma"
import {
  clearSettingsCache,
  getSetting,
  setSetting,
} from "../settings"

const mockedPrisma = prisma as unknown as {
  parametre: {
    findUnique: ReturnType<typeof vi.fn>
    upsert: ReturnType<typeof vi.fn>
  }
}

const envKeys = [
  "NOTIF_ENABLED",
  "NOTIF_RESUME_HEURE",
  "NOTIF_METEO_INTERVAL_MIN",
  "TZ",
] as const

describe("réglages globaux", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearSettingsCache()
    for (const key of envKeys) delete process.env[key]
    mockedPrisma.parametre.findUnique.mockResolvedValue(null)
    mockedPrisma.parametre.upsert.mockResolvedValue(undefined)
  })

  it("privilégie la valeur en base sur la variable d'environnement", async () => {
    process.env.NOTIF_ENABLED = "true"
    mockedPrisma.parametre.findUnique.mockResolvedValue({ valeur: "false" })

    await expect(getSetting("notif.enabled")).resolves.toBe(false)
  })

  it("utilise la variable d'environnement quand la base est vide", async () => {
    process.env.NOTIF_ENABLED = "false"

    await expect(getSetting("notif.enabled")).resolves.toBe(false)
  })

  it("utilise la valeur par défaut sans base ni variable d'environnement", async () => {
    await expect(getSetting("notif.resumeHeure")).resolves.toBe("07:00")
  })

  it("coerce les booléens et valide les heures", async () => {
    mockedPrisma.parametre.findUnique
      .mockResolvedValueOnce({ valeur: "true" })
      .mockResolvedValueOnce({ valeur: "23:59" })

    await expect(getSetting("notif.enabled")).resolves.toBe(true)
    await expect(getSetting("notif.resumeHeure")).resolves.toBe("23:59")
  })

  it("borne les nombres de configuration des notifications", async () => {
    process.env.NOTIF_METEO_INTERVAL_MIN = "2"
    await expect(getSetting("notif.meteoIntervalMin")).resolves.toBe(5)

    clearSettingsCache()
    process.env.NOTIF_METEO_INTERVAL_MIN = "9999"
    await expect(getSetting("notif.meteoIntervalMin")).resolves.toBe(1440)
  })

  it("rejette une clé absente du registre", async () => {
    await expect(setSetting("notif.inconnue" as never, true)).rejects.toThrow(
      "Clé de réglage inconnue"
    )
  })

  it("rejette une valeur invalide ou hors bornes", async () => {
    await expect(setSetting("notif.enabled", "oui")).rejects.toThrow(
      "Valeur invalide"
    )
    await expect(setSetting("notif.meteoIntervalMin", 2)).rejects.toThrow(
      "Valeur invalide"
    )
    await expect(setSetting("notif.resumeHeure", "7:00")).rejects.toThrow(
      "Valeur invalide"
    )
  })

  it("effectue un upsert avec la valeur normalisée", async () => {
    await setSetting("notif.enabled", false)

    expect(mockedPrisma.parametre.upsert).toHaveBeenCalledWith({
      where: { id: "notif.enabled" },
      create: { id: "notif.enabled", valeur: "false" },
      update: { valeur: "false" },
    })
  })
})
