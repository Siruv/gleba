/**
 * Mapping des categories d'especes vers emojis botaniques
 */

export const CATEGORIES_EMOJIS: Record<string, string> = {
  // Catégories génériques
  'vivace': '🌿',
  'arbre fruitier': '🍎',
  'aromatique': '🌿',
  'legume': '🥬',
  'légume': '🥬',
  'petit fruit': '🍓',
  'fleur': '🌸',
  'engrais vert': '🟩',
  'ornement': '🌺',
  'racine': '🥕',
  'bulbe': '🧅',
  'feuille': '🥗',
  'fruit': '🍎',
  'agrume': '🍊',
  'mellifere': '🐝',
  'bois': '🪵',
  'arbre': '🌳',

  // Spécifiques botaniques (pour matcher les libellés en base si présents)
  'ail': '🧄',
  'oignon': '🧅',
  'pomme de terre': '🥔',
  'tomate': '🍅',
  'carotte': '🥕',
  'chou': '🥬',
  'fraise': '🍓',
  'pomme': '🍎',
  'poire': '🍐',
  'cerise': '🍒',
  'framboise': '🍇',
  'menthe': '🌿',
  'basilic': '🌿',
  'romarin': '🌿',
  'thym': '🌿',
  'lavande': '💜',
  'rose': '🌹',
  'tournesol': '🌻',
}

/**
 * Retourne l'emoji pour une categorie donnee
 */
export function getCategorieEmoji(categorie: string | null | undefined): string {
  if (!categorie) return ''
  const key = categorie.toLowerCase().trim()
  
  // 1. Match exact
  if (CATEGORIES_EMOJIS[key]) return CATEGORIES_EMOJIS[key]
  
  // 2. Match sans accents
  const normalized = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (CATEGORIES_EMOJIS[normalized]) return CATEGORIES_EMOJIS[normalized]
  
  return ''
}

