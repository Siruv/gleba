import prisma from "@/lib/prisma"

export async function construireContexteMeteo(userId: string): Promise<string | null> {
  try {
    const parcelle = await prisma.parcelleGeo.findFirst({
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
    })

    if (!parcelle || parcelle.centroidLat === null || parcelle.centroidLng === null) {
      return null
    }

    const { fetchOpenMeteoForecast } = await import("@/lib/meteo")
    const forecast = await fetchOpenMeteoForecast(parcelle.centroidLat, parcelle.centroidLng)
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
}
