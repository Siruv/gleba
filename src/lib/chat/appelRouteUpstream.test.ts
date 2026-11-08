/**
 * Helper d'appel en processus des routes d'upstream (phase 2c, approche A).
 * Les handlers sont ceux d'upstream, appelés pour de vrai ; seuls leurs
 * dépendances de bas niveau (auth, prisma) sont simulées.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextResponse, type NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
}))

vi.mock("next/headers", () => ({ headers: mocks.headers }))

import { appelerRouteUpstream, messageDepuisReponse } from "./appelRouteUpstream"

const enTetes = (valeurs: Record<string, string>) => new Headers(valeurs)

/** Handler factice qui renvoie ce que l'on veut et mémorise la requête reçue. */
function handlerRenvoyant(statut: number, corps: unknown, recu: { requete?: NextRequest; ctx?: unknown } = {}) {
  return async (requete: NextRequest, ctx?: unknown) => {
    recu.requete = requete
    recu.ctx = ctx
    return NextResponse.json(corps, { status: statut })
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.headers.mockResolvedValue(enTetes({ cookie: "authjs.session-token=abc", "x-forwarded-for": "203.0.113.9" }))
})

describe("construction de la requête", () => {
  it("transmet le cookie de session, la méthode, le corps JSON et les paramètres de route", async () => {
    const recu: { requete?: NextRequest; ctx?: unknown } = {}
    const res = await appelerRouteUpstream(handlerRenvoyant(201, { id: 7 }, recu), {
      methode: "POST",
      chemin: "/api/cultures",
      corps: { especeId: "Tomate" },
      params: { id: "42" },
    })
    expect(res).toEqual({ ok: true, statut: 201, donnees: { id: 7 } })
    expect(recu.requete!.method).toBe("POST")
    expect(recu.requete!.headers.get("cookie")).toBe("authjs.session-token=abc")
    expect(recu.requete!.headers.get("x-forwarded-for")).toBe("203.0.113.9")
    expect(recu.requete!.headers.get("content-type")).toContain("application/json")
    expect(await recu.requete!.json()).toEqual({ especeId: "Tomate" })
    expect(await (recu.ctx as { params: Promise<unknown> }).params).toEqual({ id: "42" })
  })

  it("ne transmet jamais l'en-tête de mutation du middleware (la garde d'upstream lit le contexte ambiant)", async () => {
    mocks.headers.mockResolvedValue(enTetes({ cookie: "c=1", "x-gleba-mutation": "0" }))
    const recu: { requete?: NextRequest } = {}
    await appelerRouteUpstream(handlerRenvoyant(200, {}, recu), { methode: "DELETE", chemin: "/api/planches/a" })
    expect(recu.requete!.headers.get("x-gleba-mutation")).toBeNull()
  })

  it("sans contexte de requête (headers() lève), appelle quand même le handler : c'est son auth() qui répondra 401", async () => {
    mocks.headers.mockRejectedValue(new Error("headers() outside request scope"))
    const res = await appelerRouteUpstream(handlerRenvoyant(401, { error: "Non autorisé" }), {
      methode: "DELETE",
      chemin: "/api/cultures/1",
    })
    expect(res).toMatchObject({ ok: false, statut: 401 })
  })
})

describe("normalisation des réponses", () => {
  const cas: Array<[number, unknown, RegExp]> = [
    [400, { error: "Données invalides", details: { fieldErrors: { largeur: ["Trop grand"] }, formErrors: [] } }, /Données invalides.*largeur.*Trop grand/],
    [401, { error: "Non autorisé" }, /Non autorisé/],
    [403, { error: "Votre rôle dans cette exploitation ne permet pas de modifier les données.", code: "LECTURE_SEULE" }, /ne permet pas de modifier/],
    [404, { error: "Culture #9 non trouvée" }, /Culture #9 non trouvée/],
    [409, { error: "Cette culture possède des lots liés à des bons ou factures." }, /lots liés/],
    [422, { error: "Entité non traitable" }, /non traitable/],
    [429, { error: "Trop de requêtes, veuillez réessayer plus tard" }, /Trop de requêtes/],
  ]

  it.each(cas)("statut %i : refus métier avec le message d'upstream tel quel", async (statut, corps, motif) => {
    const res = await appelerRouteUpstream(handlerRenvoyant(statut, corps), { methode: "POST", chemin: "/api/x" })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.statut).toBe(statut)
    expect(res.message).toMatch(motif)
    expect(res.avertissement).toBe(false)
  })

  it("409 d'avertissement (rotation) : message tel quel, marqué avertissement, jamais forcé", async () => {
    const res = await appelerRouteUpstream(
      handlerRenvoyant(409, { warning: "Rotation non respectée : Tomate après Tomate. Continuer ?", rotationViolation: { message: "x" } }),
      { methode: "POST", chemin: "/api/cultures" },
    )
    expect(res).toEqual({
      ok: false,
      statut: 409,
      message: "Rotation non respectée : Tomate après Tomate. Continuer ?",
      avertissement: true,
    })
  })

  it("500 : message générique, jamais le détail ni la pile", async () => {
    const res = await appelerRouteUpstream(
      handlerRenvoyant(500, { error: "PrismaClientKnownRequestError at /srv/app/node_modules/..." }),
      { methode: "POST", chemin: "/api/x" },
    )
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.message).not.toMatch(/Prisma|node_modules|srv/)
    expect(res.message).toMatch(/Erreur interne/)
  })

  it("exception du handler : refus générique sans pile, et le message d'exception n'est pas exposé", async () => {
    const res = await appelerRouteUpstream(
      async () => {
        throw new Error("ECONNREFUSED 10.0.0.5:5432 at Object.connect (/srv/app/x.js:1:1)")
      },
      { methode: "POST", chemin: "/api/x" },
    )
    expect(res).toMatchObject({ ok: false, statut: 500 })
    if (res.ok) return
    expect(res.message).not.toMatch(/ECONNREFUSED|srv|10\.0/)
  })

  it("réponse non JSON : refus générique", async () => {
    const res = await appelerRouteUpstream(async () => new Response("<html>boom</html>", { status: 502 }), {
      methode: "POST",
      chemin: "/api/x",
    })
    expect(res).toMatchObject({ ok: false, statut: 502 })
    if (res.ok) return
    expect(res.message).not.toMatch(/html|boom/)
  })

  it("succès sans corps JSON exploitable : donnees vide", async () => {
    const res = await appelerRouteUpstream(async () => new Response(null, { status: 204 }), {
      methode: "DELETE",
      chemin: "/api/x",
    })
    expect(res).toEqual({ ok: true, statut: 204, donnees: {} })
  })
})

describe("messageDepuisReponse", () => {
  it("préfère error, puis warning, puis le message par défaut du statut", () => {
    expect(messageDepuisReponse(400, { error: "a", warning: "b" })).toBe("a")
    expect(messageDepuisReponse(409, { warning: "b" })).toBe("b")
    expect(messageDepuisReponse(404, {})).toMatch(/introuvable/i)
  })
})
