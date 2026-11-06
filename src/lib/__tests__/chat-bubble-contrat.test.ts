import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { EVENEMENT_OUVRIR_ASSISTANT } from "@/lib/accueil/evenements"

// Contrat avec les règles « coquille v2 » de globals.css et les déclencheurs de l'accueil.
const sourceBulle = readFileSync(join(__dirname, "../../components/chat/ChatBubble.tsx"), "utf8")
const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8")

describe("contrat ChatBubble / coquille v2", () => {
  it("expose les aria-labels ciblés par globals.css", () => {
    for (const label of ["Assistant IA", "Fermer l'assistant"]) {
      expect(sourceBulle).toContain(`aria-label="${label}"`)
      expect(css).toContain(`button.fixed[aria-label="${label}"]`)
    }
  })

  it("marque le panneau compact avec data-assistant-panel", () => {
    expect(sourceBulle).toMatch(/data-assistant-panel=\{isExpanded \? undefined : "compact"\}/)
    expect(css).toContain('[data-assistant-panel="compact"]')
  })

  it("écoute l'événement d'ouverture de l'assistant et nettoie au démontage", () => {
    expect(EVENEMENT_OUVRIR_ASSISTANT).toBe("gleba:ouvrir-assistant")
    expect(sourceBulle).toContain("addEventListener(EVENEMENT_OUVRIR_ASSISTANT")
    expect(sourceBulle).toContain("removeEventListener(EVENEMENT_OUVRIR_ASSISTANT")
    expect(sourceBulle).toContain('addEventListener("ouvrir-chat"')
  })
})
