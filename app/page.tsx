import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { BarChart3, Users, Sheet } from 'lucide-react'

export default async function LandingPage() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect('/dashboard')
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Nav */}
      <header className="flex h-14 items-center justify-between border-b px-4 md:px-6">
        <span className="font-bold text-lg">BankFlow</span>
        <Link href="/login">
          <Button variant="outline" size="sm">
            Sign in
          </Button>
        </Link>
      </header>

      {/* Hero */}
      <section className="flex flex-1 flex-col items-center justify-center px-4 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Track spending. Share budgets.
          <br />
          Sync to Sheets.
        </h1>
        <p className="mt-4 max-w-lg text-muted-foreground">
          Upload your bank CSV, categorize transactions, and keep your personal or group budgets on
          track — all in one place.
        </p>
        <Link href="/login" className="mt-8">
          <Button size="lg">Get Started</Button>
        </Link>
      </section>

      {/* Feature cards */}
      <section className="border-t bg-muted/40 px-4 py-16 md:px-6">
        <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-3">
          <FeatureCard
            icon={<BarChart3 className="h-8 w-8" />}
            title="Budget Tracking"
            description="Set category limits, track spending with progress bars, and stay on top of your finances."
          />
          <FeatureCard
            icon={<Users className="h-8 w-8" />}
            title="Group Budgets"
            description="Share budgets with friends or family. Everyone uploads their own transactions."
          />
          <FeatureCard
            icon={<Sheet className="h-8 w-8" />}
            title="Google Sheets Sync"
            description="One-click sync to Google Sheets. Auto-share with group members."
          />
        </div>
      </section>
    </div>
  )
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-3 text-primary">{icon}</div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  )
}
