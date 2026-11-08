import { describe, expect, it, vi } from "vitest"
import {
  CONSIGNE_ECRITURE_REPETEE,
  MESSAGE_PLAFOND_ECRITURES,
  PLAFOND_ECRITURES_PAR_REQUETE,
  cleAppel,
  creerGardeEcritures,
  messageTropAppels,
} from "./gardeEcritures"

const ok = (message: string) => JSON.stringify({ message })

describe("gardeEcritures", () => {
  it("un appel identique deux fois n'exécute qu'une écriture et renvoie le premier résultat avec une consigne", async () => {
    const garde = creerGardeEcritures()
    const handler = vi.fn().mockResolvedValue(ok("Culture créée (id 1)"))
    await garde.executer("create_culture", '{"a":1,"b":2}', handler)
    const second = JSON.parse(await garde.executer("create_culture", '{"b":2,"a":1}', handler))
    expect(handler).toHaveBeenCalledTimes(1)
    expect(second.message).toBe("Culture créée (id 1)")
    expect(second.consigne).toBe(CONSIGNE_ECRITURE_REPETEE)
  })

  it("des arguments différents donnent deux écritures", async () => {
    const garde = creerGardeEcritures()
    const handler = vi.fn().mockResolvedValue(ok("ok"))
    await garde.executer("create_culture", '{"a":1}', handler)
    await garde.executer("create_culture", '{"a":2}', handler)
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it("deux appels identiques simultanés ne s'exécutent qu'une fois", async () => {
    const garde = creerGardeEcritures()
    const handler = vi.fn().mockResolvedValue(ok("ok"))
    await Promise.all([
      garde.executer("create_culture", "{}", handler),
      garde.executer("create_culture", "{}", handler),
    ])
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("le plafond d'écritures distinctes bloque sans rien exécuter", async () => {
    const garde = creerGardeEcritures()
    const handler = vi.fn().mockResolvedValue(ok("ok"))
    for (let i = 0; i < PLAFOND_ECRITURES_PAR_REQUETE; i++) {
      await garde.executer("create_culture", JSON.stringify({ i }), handler)
    }
    const refus = JSON.parse(await garde.executer("create_culture", '{"i":99}', handler))
    expect(refus.erreur).toBe(MESSAGE_PLAFOND_ECRITURES)
    expect(handler).toHaveBeenCalledTimes(PLAFOND_ECRITURES_PAR_REQUETE)
  })

  it("une écriture échouée ne consomme pas le plafond et peut être retentée", async () => {
    const garde = creerGardeEcritures()
    const handler = vi.fn().mockResolvedValueOnce(JSON.stringify({ erreur: "x" })).mockResolvedValue(ok("ok"))
    await garde.executer("create_culture", "{}", handler)
    await garde.executer("create_culture", "{}", handler)
    expect(handler).toHaveBeenCalledTimes(2)
    expect(garde.realisees).toHaveLength(1)
  })

  it("deux gardes (deux requêtes) sont isolées", async () => {
    const a = creerGardeEcritures()
    const b = creerGardeEcritures()
    const handler = vi.fn().mockResolvedValue(ok("ok"))
    await Promise.all([a.executer("create_x", "{}", handler), b.executer("create_x", "{}", handler)])
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it("le message de plafond d'itérations liste les écritures réalisées", async () => {
    const garde = creerGardeEcritures()
    await garde.executer("create_culture", "{}", async () => ok("Culture créée (id 7)"))
    const message = messageTropAppels(garde)
    expect(message).toContain("create_culture")
    expect(message).toContain("Culture créée (id 7)")
    expect(messageTropAppels(creerGardeEcritures())).toBe("Trop d'appels d'outils consécutifs.")
  })

  it("cleAppel est stable sur l'ordre des clés imbriquées", () => {
    expect(cleAppel("u", '{"a":{"x":1,"y":2}}')).toBe(cleAppel("u", '{"a":{"y":2,"x":1}}'))
  })
})
