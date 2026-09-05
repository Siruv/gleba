#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()

async function main() {
  console.log('==> Seeding associations referential...')
  const filePath = path.resolve(process.cwd(), 'associations_enriched_v2_2026.json')

  if (!fs.existsSync(filePath)) {
    console.error(`Fichier non trouvé: ${filePath}`)
    return
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  const associations = data.associations

  let createdAssociations = 0
  let totalDetails = 0

  for (const asso of associations) {
    // 1. Upsert Association (idempotent)
    await prisma.association.upsert({
      where: { id: asso.id },
      update: {
        nom: asso.nom,
        description: asso.description,
        notes: asso.notes,
      },
      create: {
        id: asso.id,
        nom: asso.nom,
        description: asso.description,
        notes: asso.notes,
      },
    })
    createdAssociations++

    // 2. Clear existing details for this association to ensure idempotency
    await prisma.associationDetail.deleteMany({
      where: { associationId: asso.id },
    })

    // 3. Create new details
    if (asso.details && asso.details.length > 0) {
      const detailsToCreate = []
      for (const detail of asso.details) {
        // Check if espece exists if especeId is provided
        if (detail.especeId) {
          const espece = await prisma.espece.findUnique({ where: { id: detail.especeId } })
          if (!espece) {
            console.warn(`⚠️  Espèce non trouvée: ${detail.especeId}, skip detail`)
            continue
          }
        }

        detailsToCreate.push({
          associationId: asso.id, // Using root association ID
          especeId: detail.especeId,
          familleId: detail.familleId,
          groupe: detail.groupe,
          requise: detail.requise,
          notes: detail.notes,
        })
      }

      if (detailsToCreate.length > 0) {
        await prisma.associationDetail.createMany({
          data: detailsToCreate,
        })
        totalDetails += detailsToCreate.length
      }
    }
  }

  console.log(`✓ ${createdAssociations} associations, ${totalDetails} details importés`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
