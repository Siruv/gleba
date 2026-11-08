import { describe, expect, it } from "vitest"
import * as prive from "./daily-opening"
import * as upstream from "../briefing-prefs"

describe("daily-opening délègue à la source de vérité d'upstream", () => {
  it("réexporte la même clé et la même valeur par défaut", () => {
    expect(prive.CLE_PREF_BRIEFING_AUTO).toBe(upstream.CLE_PREF_BRIEFING_AUTO)
    expect(prive.CLE_PREF_BRIEFING_AUTO).toBe("briefingQuotidienAuto")
    expect(prive.BRIEFING_AUTO_PAR_DEFAUT).toBe(upstream.BRIEFING_AUTO_PAR_DEFAUT)
  })

  it("lit la clé écrite par la page Paramètres", () => {
    expect(prive.briefingAutoActive({ briefingQuotidienAuto: true })).toBe(true)
    expect(prive.briefingAutoActive({ briefingAuto: true })).toBe(false)
  })
})
