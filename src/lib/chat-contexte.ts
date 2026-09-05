import prisma from "@/lib/prisma"

export async function construireContexteMeteo(userId: string): Promise<string | null> {
  try {
    const parcelles = await prisma.parcelleGeo.findMany({
      where: {
        userId,
        centroidLat: { not: null },
        centroidLng: { not: null },
      },
      select: {
        id: true,
        nom: true,
        centroidLat: true,
        centroidLng: true,
      },
      orderBy: { nom: "asc" },
      take: 5,
    })

    const parcellesAvecCoordonnees = parcelles.filter(
      (parcelle) => parcelle.centroidLat !== null && parcelle.centroidLng !== null
    )
    if (parcellesAvecCoordonnees.length === 0) return null

    const { fetchOpenMeteoForecast } = await import("@/lib/meteo")
    const contextes = await Promise.all(
      parcellesAvecCoordonnees.map(async (parcelle) => {
        try {
          const forecast = await fetchOpenMeteoForecast(parcelle.centroidLat!, parcelle.centroidLng!)
          const actuelle = forecast.current
            ? `Actuelle : ${Math.round(forecast.current.temperature)}°C, ${forecast.current.weatherDescription}, humidité ${forecast.current.humidity}%, vent ${forecast.current.windSpeed} km/h.`
            : "Actuelle : Données indisponibles."
          const previsions = forecast.daily.map(
            (jour) =>
              `- ${jour.date} : ${Math.round(jour.tempMin)}°C / ${Math.round(jour.tempMax)}°C, précipitations ${jour.precipitation.toFixed(1)} mm (probabilité ${jour.precipitationProba}%)`
          )

          return [
            `Météo de la parcelle « ${parcelle.nom} » (source Open-Meteo) :`,
            actuelle,
            "Prévisions sur 7 jours :",
            ...previsions,
          ].join("\n")
        } catch {
          return null
        }
      })
    )

    const contextesRecuperes = contextes.filter((contexte): contexte is string => contexte !== null)
    return contextesRecuperes.length > 0 ? contextesRecuperes.join("\n\n") : null
  } catch {
    return null
  }
}
