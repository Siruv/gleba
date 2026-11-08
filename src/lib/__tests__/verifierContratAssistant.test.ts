import { describe, expect, it } from "vitest"

import {
  extraireConstanteTexte,
  extraireImportsPrives,
  extraireInterfaceProps,
  extraireMethodesHttp,
  extraireProprietesJsx,
  lireOptions,
  resoudreModule,
} from "../../../scripts/verifierContratAssistant"

describe("verifierContratAssistant : fonctions pures", () => {
  it("lit les props requises et optionnelles, commentaires ignorés", () => {
    const source = `
      interface ChatPanelProps {
        onClose: () => void
        // section?: string  (commentaire)
        section?: string
        /** doc */
        isExpanded?: boolean
      }`
    const props = extraireInterfaceProps(source, "ChatPanelProps")
    expect([...(props?.requises ?? [])]).toEqual(["onClose"])
    expect([...(props?.optionnelles ?? [])]).toEqual(["section", "isExpanded"])
  })

  it("rend null si l'interface est absente", () => {
    expect(extraireInterfaceProps("const a = 1", "ChatPanelProps")).toBeNull()
  })

  it("relève les attributs JSX de premier niveau sans confondre les fonctions fléchées", () => {
    const source = `<ChatPanel
      onClose={() => { setShowChat(false) }}
      section="verger"
      isExpanded={x > 1}
      onToggleExpanded={() => setX((c) => !c)}
    />`
    expect(extraireProprietesJsx(source, "ChatPanel")).toEqual([
      ["onClose", "section", "isExpanded", "onToggleExpanded"],
    ])
  })

  it("repère un spread", () => {
    expect(extraireProprietesJsx("<ChatPanel {...p} section='a' />", "ChatPanel")).toEqual([["...spread", "section"]])
  })

  it("détecte les imports privés et ignore les commentaires de type prose", () => {
    const source = `import { a } from "@/lib/chat/daily-opening"
      const m = await import("@/lib/chat-contexte")
      import x from "@/lib/chat"`
    expect(extraireImportsPrives(source)).toEqual(["@/lib/chat/daily-opening", "@/lib/chat"])
  })

  it("résout un module seulement s'il existe", () => {
    const existe = (c: string) => c === "src/lib/chat/daily-opening.ts"
    expect(resoudreModule("@/lib/chat/daily-opening", existe)).toBe("src/lib/chat/daily-opening.ts")
    expect(resoudreModule("@/lib/chat/absent", existe)).toBeNull()
  })

  it("lit une constante texte exportée", () => {
    expect(extraireConstanteTexte('export const EVENEMENT_OUVRIR_ASSISTANT = "gleba:ouvrir-assistant"', "EVENEMENT_OUVRIR_ASSISTANT")).toBe("gleba:ouvrir-assistant")
    expect(extraireConstanteTexte("const X = 'a'", "X")).toBeNull()
  })

  it("liste les méthodes HTTP exportées", () => {
    expect(extraireMethodesHttp("export async function GET() {}\nexport function POST() {}")).toEqual(["GET", "POST"])
  })

  it("valide les options", () => {
    expect(lireOptions(["--base", "origin/main"])).toMatchObject({ base: "origin/main", strict: false })
    expect(lireOptions(["--base=a", "--strict"])).toMatchObject({ base: "a", strict: true })
    expect(typeof lireOptions(["--base"])).toBe("string")
    expect(typeof lireOptions(["--base", "--delete"])).toBe("string")
    expect(typeof lireOptions(["--inconnue"])).toBe("string")
  })
})
