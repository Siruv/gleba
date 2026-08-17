import { describe, expect, it } from "vitest"
import { doitLancerScan, estHeureResume } from "./config"

describe("doitLancerScan", () => {
  it("lance le scan s'il n'a jamais été exécuté", () => {
    expect(doitLancerScan(1_000, 0, 30)).toBe(true)
  })

  it("ne lance pas le scan si l'intervalle n'est pas écoulé", () => {
    expect(doitLancerScan(30 * 60_000 - 1, 1, 30)).toBe(false)
  })

  it("lance le scan quand l'intervalle est écoulé", () => {
    expect(doitLancerScan(31 * 60_000, 1 * 60_000, 30)).toBe(true)
  })
})

describe("estHeureResume", () => {
  const matinParis = new Date("2026-08-17T05:00:00.000Z")

  it("retourne vrai quand l'heure locale correspond", () => {
    expect(estHeureResume(matinParis, "07:00", "Europe/Paris")).toBe(true)
  })

  it("retourne faux quand l'heure locale ne correspond pas", () => {
    expect(estHeureResume(matinParis, "08:00", "Europe/Paris")).toBe(false)
  })

  it("utilise Europe/Paris en fallback pour un timezone invalide", () => {
    expect(estHeureResume(matinParis, "07:00", "Timezone/Invalide")).toBe(true)
  })

  it("retourne faux pour un format HH:MM invalide", () => {
    expect(estHeureResume(matinParis, "7:00", "Europe/Paris")).toBe(false)
  })
})
