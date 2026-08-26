import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🔄 Correction des types d\'espèces...')

  const corrections = [
    { names: ['Abricotier', 'Cerisier', 'Citronnier', 'Cognassier', 'Figuier', 'Noisetier', 'Oranger', 'Pêcher', 'Châtaignier', 'Néflier'], type: 'arbre_fruitier', categorie: 'arbre fruitier' },
    { names: ['Vigne'], type: 'petit_fruit', categorie: 'petit fruit' },
    { names: ['Sauge'], type: 'aromatique', categorie: 'aromatique' },
    { names: ['Cosmos', 'Tagètes', 'Pyracantha'], type: 'ornement', categorie: 'ornement' },
  ]

  let updatedCount = 0

  for (const group of corrections) {
    for (const name of group.names) {
      const existing = await prisma.espece.findFirst({
        where: { id: name },
      })

      if (existing && (existing.type !== group.type || existing.categorie !== group.categorie)) {
        await prisma.espece.update({
          where: { id: name },
          data: {
            type: group.type,
            categorie: group.categorie,
          },
        })
        console.log(`   ✓ ${name} mis à jour : ${group.type} / ${group.categorie}`)
        updatedCount++
      }
    }
  }

  if (updatedCount === 0) {
    console.log('   ✓ Aucune mise à jour nécessaire.')
  } else {
    console.log(`   ✓ ${updatedCount} espèces corrigées.`)
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
