import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { EVENEMENT_OUVRIR_ASSISTANT } from "@/lib/accueil/evenements"

// Contrat avec les règles « coquille v2 » de globals.css et les déclencheurs de l'accueil.
const sourceBulle = readFileSync(join(__dirname, "../../components/chat/ChatBubble.tsx"), "utf8")
const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8")

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

  it("borne la hauteur du panneau compact par la fenêtre (≥ sm)", () => {
    expect(sourceBulle).not.toContain("sm:h-[540px]")
    expect(sourceBulle).toMatch(
      /sm:h-\[min\(540px,calc\(100dvh_-_var\(--app-header-visible-h,var\(--app-header-h,0px\)\)_-_5rem_-_1rem\)\)\]/,
    )
    // le bottom du panneau (sm:bottom-20 = 5rem) doit rester cohérent avec la soustraction
    expect(sourceBulle).toContain("sm:bottom-20")
  })

  it("garde la bulle à 48 px (h-12 w-12) comme upstream, comme le bouton de fermeture", () => {
    expect(sourceBulle).not.toContain("h-14 w-14")
    const boutons = sourceBulle.match(/fixed bottom-4 right-4 [^"]*/g) ?? []
    expect(boutons).toHaveLength(2)
    for (const b of boutons) expect(b).toContain("h-12 w-12")
  })
})
