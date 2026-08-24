#!/usr/bin/env ts-node
/**
 * Script one-shot pour corriger les données existantes des espèces (Lot C).
 *
 * - Pour chaque Espece où categorie IS NULL:
 *   Mapper type → categorie selon la règle:
 *   legume → "légume", aromatique → "aromatique",
 *   arbre_fruitier → "arbre fruitier", petit_fruit → "petit fruit",
 *   engrais_vert → "engrais vert", ornement → "ornement"
 *   Ou déduire depuis nom si type ambigu
 * - Pour zones_adaptees NULL:
 *   Déduire depuis type/nom si possible (ex: agrumes → tropical, pommier → tempéré)
 *   Sinon laisser NULL (pas de valeur par défaut)
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Mapping type (CSV) → categorie (pour emoji UI)
const TYPE_TO_CATEGORIE: Record<string, string> = {
  'legume': 'légume',
  'aromatique': 'aromatique',
  'arbre_fruitier': 'arbre fruitier',
  'petit_fruit': 'petit fruit',
  'engrais_vert': 'engrais vert',
  'ornement': 'ornement',
}

// Mapping mots-clés du nom → zones climatiques
const NOM_TO_ZONES: Record<string, string[]> = {
  // Agrumes → zones chaudes
  'citron': ['mediterraneen', 'tropical_antilles', 'equatorial', 'tropical_austral'],
  'orange': ['mediterraneen', 'tropical_antilles', 'equatorial', 'tropical_austral'],
  'mandarine': ['mediterraneen', 'tropical_antilles', 'equatorial', 'tropical_austral'],
  'pamplemousse': ['mediterraneen', 'tropical_antilles', 'equatorial', 'tropical_austral'],
  'kumquat': ['mediterraneen', 'tropical_antilles', 'equatorial', 'tropical_austral'],
  'agrume': ['mediterraneen', 'tropical_antilles', 'equatorial', 'tropical_austral'],
  'bergamote': ['mediterraneen', 'tropical_antilles', 'equatorial', 'tropical_austral'],
  'combava': ['tropical_antilles', 'equatorial', 'tropical_austral'],
  'yuzu': ['mediterraneen', 'tropical_antilles', 'equatorial', 'tropical_austral'],

  // Fruits tropicaux
  'bananier': ['tropical_antilles', 'equatorial', 'tropical_austral'],
  'mangue': ['tropical_antilles', 'equatorial', 'tropical_austral'],
  'papaye': ['tropical_antilles', 'equatorial', 'tropical_austral'],
  'ananas': ['tropical_antilles', 'equatorial', 'tropical_austral'],
  'fruit de la passion': ['tropical_antilles', 'equatorial', 'tropical_austral'],
  'passiflore': ['tropical_antilles', 'equatorial', 'tropical_austral'],
  'goave': ['tropical_antilles', 'equatorial', 'tropical_austral'],
  'letchi': ['tropical_antilles', 'equatorial', 'tropical_austral'],
  'longane': ['tropical_antilles', 'equatorial', 'tropical_austral'],
  'carambole': ['tropical_antilles', 'equatorial', 'tropical_austral'],

  // Arbres fruitiers tempérés (pommier, poirier, etc.)
  'pommier': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard'],
  'poirier': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard'],
  'cerisier': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard'],
  'prunier': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard'],
  'abricotier': ['mediterraneen', 'semi_continental', 'oceanique_altere'],
  'pêcher': ['mediterraneen', 'semi_continental', 'oceanique_altere'],
  'nectarinier': ['mediterraneen', 'semi_continental', 'oceanique_altere'],
  'amandier': ['mediterraneen', 'semi_continental'],
  'noisetier': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard'],
  'noyer': ['oceanique', 'oceanique_altere', 'semi_continental', 'mediterraneen'],
  'figuier': ['mediterraneen', 'oceanique_altere', 'tropical_antilles'],
  'kaki': ['mediterraneen', 'oceanique_altere', 'semi_continental'],
  'grenadier': ['mediterraneen', 'tropical_antilles', 'equatorial', 'tropical_austral'],
  'jujubier': ['mediterraneen', 'semi_continental'],

  // Petits fruits tempérés
  'fraisier': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'framboisier': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard'],
  'mûrier': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'cassissier': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard'],
  'groseillier': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard'],
  'myrtille': ['oceanique', 'oceanique_altere', 'montagnard', 'semi_continental'],
  'argousier': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard'],
  'caseille': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard'],
  'airelle': ['oceanique', 'montagnard', 'semi_continental'],

  // Légumes méditerranéens / chauds
  'tomate': ['oceanique', 'oceanique_altere', 'semi_continental', 'mediterraneen', 'tropical_antilles', 'equatorial', 'tropical_austral'],
  'poivron': ['mediterraneen', 'semi_continental', 'tropical_antilles', 'equatorial', 'tropical_austral'],
  'aubergine': ['mediterraneen', 'semi_continental', 'tropical_antilles', 'equatorial', 'tropical_austral'],
  'piment': ['mediterraneen', 'semi_continental', 'tropical_antilles', 'equatorial', 'tropical_austral'],
  'melon': ['mediterraneen', 'semi_continental', 'oceanique_altere', 'tropical_antilles', 'equatorial', 'tropical_austral'],
  'pastèque': ['mediterraneen', 'semi_continental', 'tropical_antilles', 'equatorial', 'tropical_austral'],
  'concombre': ['oceanique', 'oceanique_altere', 'semi_continental', 'mediterraneen', 'tropical_antilles', 'equatorial', 'tropical_austral'],
  'courgette': ['oceanique', 'oceanique_altere', 'semi_continental', 'mediterraneen', 'tropical_antilles', 'equatorial', 'tropical_austral'],
  'courge': ['oceanique', 'oceanique_altere', 'semi_continental', 'mediterraneen', 'tropical_antilles', 'equatorial', 'tropical_austral'],
  'potiron': ['oceanique', 'oceanique_altere', 'semi_continental', 'mediterraneen', 'tropical_antilles', 'equatorial', 'tropical_austral'],

  // Légumes racines / frais (plus tolérants au froid)
  'carotte': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'radis': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'betterave': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'navet': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'céleri': ['oceanique', 'oceanique_altere', 'semi_continental', 'mediterraneen'],
  'poireau': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'oignon': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'ail': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'échalote': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'pomme de terre': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],

  // Légumes feuilles (tolérants)
  'laitue': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'épinard': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'bette': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'chou': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'brocoli': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'chou-fleur': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'chou de bruxelles': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard'],
  'roquette': ['oceanique', 'oceanique_altere', 'semi_continental', 'mediterraneen'],
  'mâche': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],

  // Aromatiques méditerranéennes
  'romarin': ['mediterraneen', 'oceanique_altere', 'semi_continental'],
  'thym': ['mediterraneen', 'oceanique_altere', 'semi_continental', 'montagnard'],
  'lavande': ['mediterraneen', 'oceanique_altere', 'semi_continental'],
  'sauge': ['mediterraneen', 'oceanique_altere', 'semi_continental', 'montagnard'],
  'origan': ['mediterraneen', 'oceanique_altere', 'semi_continental', 'montagnard'],
  'marjolaine': ['mediterraneen', 'oceanique_altere', 'semi_continental'],
  'basilic': ['mediterraneen', 'oceanique_altere', 'semi_continental', 'tropical_antilles', 'equatorial', 'tropical_austral'],
  'menthe': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen', 'tropical_antilles', 'equatorial', 'tropical_austral'],
  'persil': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'ciboulette': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'estragon': ['mediterraneen', 'oceanique_altere', 'semi_continental'],
  'aneth': ['oceanique', 'oceanique_altere', 'semi_continental', 'mediterraneen'],
  'coriandre': ['oceanique', 'oceanique_altere', 'semi_continental', 'mediterraneen', 'tropical_antilles', 'equatorial', 'tropical_austral'],

  // Engrais verts
  'moutarde': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'phacélie': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'trèfle': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'luzerne': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'seigle': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard'],
  'avoine': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'vesce': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'sarrasin': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],

  // Ornementales
  'rose': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'rosier': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'lavatère': ['mediterraneen', 'oceanique_altere', 'semi_continental'],
  'cosmos': ['oceanique', 'oceanique_altere', 'semi_continental', 'mediterraneen'],
  'tournesol': ['oceanique', 'oceanique_altere', 'semi_continental', 'mediterraneen'],
  'dahlia': ['oceanique', 'oceanique_altere', 'semi_continental', 'mediterraneen'],
  'géranium': ['mediterraneen', 'oceanique_altere', 'semi_continental'],
  'pétunia': ['mediterraneen', 'oceanique_altere', 'semi_continental'],
  'impatiens': ['oceanique', 'oceanique_altere', 'semi_continental', 'mediterraneen'],
  'bégonia': ['mediterraneen', 'oceanique_altere', 'semi_continental'],
  'fuchsia': ['oceanique', 'oceanique_altere', 'montagnard'],
}

// Mapping type → zones par défaut (large)
const TYPE_TO_ZONES: Record<string, string[]> = {
  'arbre_fruitier': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'petit_fruit': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'legume': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'aromatique': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'engrais_vert': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
  'ornement': ['oceanique', 'oceanique_altere', 'semi_continental', 'montagnard', 'mediterraneen'],
}

function normaliserNom(nom: string): string {
  return nom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function deduireCategorie(espece: { type: string; nom: string | null }): string | null {
  // 1. Essayer depuis le type
  if (TYPE_TO_CATEGORIE[espece.type]) {
    return TYPE_TO_CATEGORIE[espece.type]
  }

  // 2. Déduire depuis le nom si type non reconnu
  const nomNorm = normaliserNom(espece.nom || '')

  if (nomNorm.includes('citron') || nomNorm.includes('orange') || nomNorm.includes('mandarine') ||
      nomNorm.includes('pamplemousse') || nomNorm.includes('kumquat') || nomNorm.includes('agrume') ||
      nomNorm.includes('bergamote') || nomNorm.includes('combava') || nomNorm.includes('yuzu')) {
    return 'arbre fruitier' // agrumes = arbres fruitiers
  }

  if (nomNorm.includes('arbre') || nomNorm.includes('pommier') || nomNorm.includes('poirier') ||
      nomNorm.includes('cerisier') || nomNorm.includes('prunier') || nomNorm.includes('abricotier') ||
      nomNorm.includes('pecher') || nomNorm.includes('nectarinier') || nomNorm.includes('amandier') ||
      nomNorm.includes('noisetier') || nomNorm.includes('noyer') || nomNorm.includes('figuier') ||
      nomNorm.includes('kaki') || nomNorm.includes('grenadier') || nomNorm.includes('jujubier')) {
    return 'arbre fruitier'
  }

  if (nomNorm.includes('fraisier') || nomNorm.includes('framboisier') || nomNorm.includes('mûrier') ||
      nomNorm.includes('cassissier') || nomNorm.includes('groseillier') || nomNorm.includes('myrtille') ||
      nomNorm.includes('argousier') || nomNorm.includes('caseille') || nomNorm.includes('airelle')) {
    return 'petit fruit'
  }

  if (nomNorm.includes('tomate') || nomNorm.includes('poivron') || nomNorm.includes('aubergine') ||
      nomNorm.includes('piment') || nomNorm.includes('melon') || nomNorm.includes('pastèque') ||
      nomNorm.includes('concombre') || nomNorm.includes('courgette') || nomNorm.includes('courge') ||
      nomNorm.includes('potiron') || nomNorm.includes('carotte') || nomNorm.includes('radis') ||
      nomNorm.includes('betterave') || nomNorm.includes('navet') || nomNorm.includes('céleri') ||
      nomNorm.includes('poireau') || nomNorm.includes('oignon') || nomNorm.includes('ail') ||
      nomNorm.includes('échalote') || nomNorm.includes('pomme de terre') || nomNorm.includes('laitue') ||
      nomNorm.includes('épinard') || nomNorm.includes('bette') || nomNorm.includes('chou') ||
      nomNorm.includes('brocoli') || nomNorm.includes('chou-fleur') || nomNorm.includes('roquette') ||
      nomNorm.includes('mâche')) {
    return 'légume'
  }

  if (nomNorm.includes('romarin') || nomNorm.includes('thym') || nomNorm.includes('lavande') ||
      nomNorm.includes('sauge') || nomNorm.includes('origan') || nomNorm.includes('marjolaine') ||
      nomNorm.includes('basilic') || nomNorm.includes('menthe') || nomNorm.includes('persil') ||
      nomNorm.includes('ciboulette') || nomNorm.includes('estragon') || nomNorm.includes('aneth') ||
      nomNorm.includes('coriandre')) {
    return 'aromatique'
  }

  if (nomNorm.includes('moutarde') || nomNorm.includes('phacélie') || nomNorm.includes('trèfle') ||
      nomNorm.includes('luzerne') || nomNorm.includes('seigle') || nomNorm.includes('avoine') ||
      nomNorm.includes('vesce') || nomNorm.includes('sarrasin')) {
    return 'engrais vert'
  }

  if (nomNorm.includes('rose') || nomNorm.includes('rosier') || nomNorm.includes('lavatère') ||
      nomNorm.includes('cosmos') || nomNorm.includes('tournesol') || nomNorm.includes('dahlia') ||
      nomNorm.includes('géranium') || nomNorm.includes('pétunia') || nomNorm.includes('impatiens') ||
      nomNorm.includes('bégonia') || nomNorm.includes('fuchsia')) {
    return 'ornement'
  }

  return null
}

function deduireZones(espece: { type: string; nom: string | null }): string | null {
  const nomNorm = normaliserNom(espece.nom || '')

  // 1. Essayer correspondance exacte sur mots-clés du nom
  for (const [motCle, zones] of Object.entries(NOM_TO_ZONES)) {
    if (nomNorm.includes(motCle)) {
      return zones.join(',')
    }
  }

  // 2. Fallback sur le type
  if (TYPE_TO_ZONES[espece.type]) {
    return TYPE_TO_ZONES[espece.type].join(',')
  }

  // 3. Pas de déduction possible → null
  return null
}

async function main() {
  console.log('🔧 Correction catégories et zones d\'adaptation (Lot C)\n')

  // Récupérer toutes les espèces officielles (userId = null) + perso si nécessaire
  const especes = await prisma.espece.findMany({
    where: {
      // On corrige toutes les espèces (officielles + perso)
      // Pour ne toucher qu'aux officielles : where: { userId: null }
    },
    select: {
      id: true,
      nom: true,
      type: true,
      categorie: true,
      zonesAdaptees: true,
    },
    orderBy: { id: 'asc' },
  })

  console.log(`📊 ${especes.length} espèces trouvées`)

  let categoriesCorrigees = 0
  let zonesCorrigees = 0

  for (const espece of especes) {
    const updates: { categorie?: string; zonesAdaptees?: string } = {}
    let aBesoinUpdate = false

    // Corriger categorie si NULL
    if (!espece.categorie) {
      const categorie = deduireCategorie(espece)
      if (categorie) {
        updates.categorie = categorie
        aBesoinUpdate = true
        categoriesCorrigees++
        console.log(`  ✅ ${espece.id}: categorie → "${categorie}" (type: ${espece.type})`)
      } else {
        console.log(`  ⚠️ ${espece.id}: impossible de déduire la categorie (type: ${espece.type}, nom: ${espece.nom})`)
      }
    }

    // Corriger zonesAdaptees si NULL
    if (!espece.zonesAdaptees) {
      const zones = deduireZones(espece)
      if (zones) {
        updates.zonesAdaptees = zones
        aBesoinUpdate = true
        zonesCorrigees++
        console.log(`  ✅ ${espece.id}: zones_adaptees → "${zones}" (type: ${espece.type})`)
      } else {
        console.log(`  ℹ️ ${espece.id}: zones_adaptees laissé NULL (type: ${espece.type}, nom: ${espece.nom})`)
      }
    }

    if (aBesoinUpdate) {
      await prisma.espece.update({
        where: { id: espece.id },
        data: updates,
      })
    }
  }

  console.log(`\n📈 Résumé:`)
  console.log(`  - Catégories corrigées: ${categoriesCorrigees}`)
  console.log(`  - Zones d'adaptation corrigées: ${zonesCorrigees}`)
  console.log(`\n✅ Terminé !`)
}

main()
  .catch((e) => {
    console.error('❌ Erreur:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())