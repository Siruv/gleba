"use client"

/**
 * Page d'accueil Maraîchage — onglets du module (PROMPT 21, Lot D).
 * Affiche la barre d'onglets ModuleTabBar (accent emerald) et le contenu
 * de l'onglet actif. L'onglet est synchronisé avec l'URL via ?tab=.
 */

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ModuleTabBar } from "@/components/shell/ModuleTabBar"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
  Sprout,
  Wheat,
  Layout,
  Leaf,
  FileText,
  GitBranch,
  ArrowRight,
} from "lucide-react"

const TABS = [
  { id: "cultures", label: "Cultures", icon: Sprout, href: "/maraichage/cultures" },
  { id: "recoltes", label: "Récoltes", icon: Wheat, href: "/maraichage/recoltes" },
  { id: "planches", label: "Planches", icon: Layout, href: "/maraichage/planches" },
  { id: "especes", label: "Espèces", icon: Leaf, href: "/maraichage/especes" },
  { id: "itps", label: "ITP", icon: FileText, href: "/maraichage/itps" },
  { id: "associations", label: "Associations", icon: GitBranch, href: "/maraichage/associations" },
] as const

type TabId = (typeof TABS)[number]["id"]

const TAB_INFOS: Record<TabId, { title: string; description: string }> = {
  cultures: {
    title: "Cultures",
    description: "Gestion des cultures en cours, semis, plantations et suivi parcellaire.",
  },
  recoltes: {
    title: "Récoltes",
    description: "Enregistrement et suivi des récoltes par planche, variété et date.",
  },
  planches: {
    title: "Planches",
    description: "Organisation des planches de culture, dimensions, rotation et état.",
  },
  especes: {
    title: "Espèces",
    description: "Référentiel des espèces cultivées, variétés, familles botaniques.",
  },
  itps: {
    title: "ITP",
    description: "Itinéraires techniques de production par espèce et variété.",
  },
  associations: {
    title: "Associations",
    description: "Compagnonnage végétal, associations bénéfiques et répulsives.",
  },
}

function MaraichagePageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const activeTab = (searchParams.get("tab") as TabId) || "cultures"

  const handleTabChange = (tab: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", tab)
    router.push(`/maraichage?${params.toString()}`)
  }

  const info = TAB_INFOS[activeTab]

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Barre d'onglets du module */}
      <ModuleTabBar
        tabs={TABS.map(({ id, label, icon }) => ({ id, label, icon }))}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        accent="emerald"
      />

      {/* Contenu de l'onglet actif */}
      <main className="container mx-auto px-4 py-8 max-w-[1600px]">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">{info.title}</h1>
          <p className="mt-2 text-slate-600">{info.description}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {TABS.map((tab) => (
            <Card
              key={tab.id}
              className={`transition-all hover:shadow-lg ${
                activeTab === tab.id ? "ring-2 ring-emerald-500 bg-emerald-50" : ""
              }`}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <tab.icon className="h-5 w-5 text-emerald-600" />
                  {tab.label}
                </CardTitle>
                <CardDescription>{TAB_INFOS[tab.id].description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Link
                  href={tab.href}
                  className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600 hover:text-emerald-700"
                >
                  Accéder
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  )
}

export default function MaraichagePage() {
  return (
    <React.Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p>Chargement...</p></div>}>
      <MaraichagePageInner />
    </React.Suspense>
  )
}