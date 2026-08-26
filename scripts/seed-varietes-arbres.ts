/**
 * Wrapper pour exécuter seed-varietes-arbres.sql via Prisma
 * (psql n'est pas disponible dans le conteneur app standalone)
 *
 * Usage: npx tsx scripts/seed-varietes-arbres.ts
 */

import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()

async function main() {
  const sqlPath = path.join(process.cwd(), 'prisma', 'seed-varietes-arbres.sql')

  if (!fs.existsSync(sqlPath)) {
    console.log('⚠️  Fichier seed-varietes-arbres.sql introuvable, skip')
    return
  }

  const sql = fs.readFileSync(sqlPath, 'utf-8')

  // Découper sur ';\n' (17 statements, tous en fin de ligne, aucun dans littéraux)
  const statements = sql
    .split(';\n')
    .map(s => s.trim())
    .filter(s => s.length > 0)
    // Ignorer les blocs ne contenant que des commentaires SQL
    .filter(s => s.split('\n').some(l => !l.trim().startsWith('--') && l.trim().length > 0))

  let executed = 0
  let errors = 0

  for (const stmt of statements) {
    try {
      await prisma.$executeRawUnsafe(stmt)
      executed++
    } catch (err) {
      errors++
      console.error('Erreur exécution statement:', err)
      // Continuer : le seed ne doit jamais faire échouer le démarrage
    }
  }

  console.log(`🌱 Seed variétés arbres: ${executed} statements exécutés, ${errors} en erreur`)
}

main()
  .catch(e => console.error('Erreur fatale seed-varietes-arbres:', e))
  .finally(() => prisma.$disconnect())