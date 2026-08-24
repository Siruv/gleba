with open("src/instrumentation.ts", "r") as f:
    content = f.read()

# Fix instrumentation.ts
new_content = """export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  try {
    const { installErrorJournal } = await import('@/lib/error-journal')
    installErrorJournal()
  } catch (error) {
    console.error("[instrumentation] Échec d'installation du journal d'erreurs:", error)
  }

  try {
    const { initNotifScheduler } = await import('@/lib/notifications/scheduler')
    await initNotifScheduler()
  } catch (error) {
    console.error("[notifications] Échec d'initialisation du scheduler:", error)
  }
}"""

# Replace the whole function body or similar
# The file is not too large, let's just rewrite the register function
import re
pattern = r"export async function register\(\) \{[\s\S]*?\}\n\n"
content = re.sub(pattern, new_content + "\n\n", content)

with open("src/instrumentation.ts", "w") as f:
    f.write(content)
