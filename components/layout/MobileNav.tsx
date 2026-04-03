'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/lib/hooks/use-user'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Settings, LogOut } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { Budget } from '@/types/database'
import { cn } from '@/lib/utils'

export function MobileNav() {
  const pathname = usePathname()
  const router = useRouter()
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

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  const displayName = user?.user_metadata?.full_name ?? user?.email?.split('@')[0]
  const initials = displayName
    ? displayName
        .split(' ')
        .map((n: string) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : (user?.email?.charAt(0).toUpperCase() ?? '?')

  return (
    <div className="md:hidden">
      {/* Top bar */}
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-background px-4">
        <Link href="/dashboard" className="font-bold text-lg">
          BankFlow
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger className="cursor-pointer">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => router.push('/settings')}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* Horizontal budget pill bar */}
      <div className="sticky top-14 z-30 flex gap-2 overflow-x-auto border-b bg-background px-4 py-2 scrollbar-none">
        {budgets.map((budget) => {
          const isActive = pathname === `/budget/${budget.id}`
          return (
            <Link
              key={budget.id}
              href={`/budget/${budget.id}`}
              className={cn(
                'shrink-0 rounded-full px-3 py-1 text-sm whitespace-nowrap',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}
            >
              {budget.name}
            </Link>
          )
        })}
        <Link
          href="/budget/new"
          className="shrink-0 rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground hover:bg-muted/80 whitespace-nowrap"
        >
          + New
        </Link>
      </div>
    </div>
  )
}
