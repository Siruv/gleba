import { describe, expect, it } from "vitest"
import { briefingEstVide, type BriefingPayload } from "./daily-briefing"

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
