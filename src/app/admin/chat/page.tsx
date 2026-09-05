import { requireAdmin } from "@/lib/auth-utils"
import { ReglagesChat } from "@/components/admin/ReglagesChat"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Bot, Shield } from "lucide-react"
import Link from "next/link"

export default async function ChatSettingsPage() {
  await requireAdmin()

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-white">
      <header className="sticky top-0 z-50 border-b bg-white/80 backdrop-blur-sm">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-4">
            <Link href="/admin">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Shield className="h-6 w-6 text-amber-600" />
              <h1 className="text-xl font-bold text-amber-800">Réglages du chat IA</h1>
            </div>
          </div>
          <Bot className="h-6 w-6 text-amber-600" />
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <ReglagesChat />
      </main>
    </div>
  )
}
