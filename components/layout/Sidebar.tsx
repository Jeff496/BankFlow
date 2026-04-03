'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/lib/hooks/use-user'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { Settings, Plus, LogOut } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { Budget } from '@/types/database'
import { cn } from '@/lib/utils'

function getInitials(name: string | null | undefined, email: string | undefined) {
  if (name) {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }
  return email?.charAt(0).toUpperCase() ?? '?'
}

export function Sidebar() {
  const pathname = usePathname()
  const { user } = useUser()
  const supabase = createClient()

  const { data: budgets = [] } = useQuery<Budget[]>({
    queryKey: ['budgets'],
    queryFn: async () => {
      const { data } = await supabase
        .from('budgets')
        .select('*')
        .is('archived_at', null)
        .order('created_at', { ascending: true })
      return (data ?? []) as Budget[]
    },
    enabled: !!user,
  })

  const personalBudgets = budgets.filter((b) => b.type === 'personal')
  const groupBudgets = budgets.filter((b) => b.type === 'group')

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  const displayName = user?.user_metadata?.full_name ?? user?.email?.split('@')[0]

  return (
    <aside className="hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0 border-r bg-sidebar text-sidebar-foreground">
      {/* Logo */}
      <div className="flex h-14 items-center px-4 font-bold text-lg">
        <Link href="/dashboard">BankFlow</Link>
      </div>

      <Separator />

      {/* Budget sections */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        <BudgetSection title="Personal" budgets={personalBudgets} pathname={pathname} />
        <BudgetSection title="Group" budgets={groupBudgets} pathname={pathname} />
      </nav>

      <Separator />

      {/* Bottom: user info + settings */}
      <div className="p-3 space-y-1">
        <Link
          href="/settings"
          className={cn(
            'flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-sidebar-accent',
            pathname === '/settings' && 'bg-sidebar-accent'
          )}
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-sidebar-accent"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
        <Separator className="my-2" />
        <div className="flex items-center gap-2 px-2">
          <Avatar className="h-7 w-7">
            <AvatarFallback className="text-xs">
              {getInitials(displayName, user?.email)}
            </AvatarFallback>
          </Avatar>
          <span className="truncate text-sm">{displayName}</span>
        </div>
      </div>
    </aside>
  )
}

function BudgetSection({
  title,
  budgets,
  pathname,
}: {
  title: string
  budgets: Budget[]
  pathname: string
}) {
  const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899']

  return (
    <div>
      <h3 className="mb-1 px-2 text-xs font-semibold uppercase text-muted-foreground">{title}</h3>
      <ul className="space-y-0.5">
        {budgets.map((budget, i) => {
          const isActive = pathname === `/budget/${budget.id}`
          return (
            <li key={budget.id}>
              <Link
                href={`/budget/${budget.id}`}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                  isActive ? 'bg-sidebar-accent font-medium' : 'hover:bg-sidebar-accent/50'
                )}
              >
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: COLORS[i % COLORS.length] }}
                />
                <span className="truncate">{budget.name}</span>
              </Link>
            </li>
          )
        })}
        <li>
          <Link
            href="/budget/new"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent/50"
          >
            <Plus className="h-3.5 w-3.5" />
            New budget
          </Link>
        </li>
      </ul>
    </div>
  )
}
