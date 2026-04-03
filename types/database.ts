// ---- Enum types ----

export type BudgetType = 'personal' | 'group'
export type MemberRole = 'owner' | 'editor' | 'viewer'
export type InvitationStatus = 'pending' | 'accepted' | 'declined'
export type UploadStatus = 'processing' | 'complete' | 'failed'

// ---- Row types ----

export type User = {
  id: string
  email: string
  display_name: string | null
  created_at: string
}

export type Budget = {
  id: string
  name: string
  type: BudgetType
  owner_id: string
  sheet_id: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export type BudgetMember = {
  id: string
  budget_id: string
  user_id: string
  role: MemberRole
  joined_at: string
}

export type Invitation = {
  id: string
  budget_id: string
  invited_by: string
  email: string
  status: InvitationStatus
  created_at: string
  expires_at: string
}

export type Category = {
  id: string
  budget_id: string
  name: string
  monthly_limit: number | null
  keywords: string[]
  color: string
  created_at: string
  updated_at: string
}

export type Upload = {
  id: string
  budget_id: string
  uploaded_by: string
  filename: string
  row_count: number
  status: UploadStatus
  created_at: string
}

export type Transaction = {
  id: string
  budget_id: string
  upload_id: string
  uploaded_by: string
  date: string
  description: string
  amount: number
  category_id: string | null
  hash: string
  created_at: string
  updated_at: string
}

export type ColumnMapping = {
  id: string
  user_id: string
  bank_name: string
  mapping: Record<string, string>
}

// ---- Insert types ----

export type BudgetInsert = Omit<
  Budget,
  'id' | 'created_at' | 'updated_at' | 'archived_at' | 'sheet_id'
> & {
  id?: string
  sheet_id?: string | null
}

export type CategoryInsert = Omit<Category, 'id' | 'created_at' | 'updated_at'> & {
  id?: string
}

export type TransactionInsert = Omit<Transaction, 'id' | 'created_at' | 'updated_at'> & {
  id?: string
}

// ---- Supabase Database type for client generics ----

export type Database = {
  public: {
    Tables: {
      users: {
        Row: User
        Insert: Omit<User, 'created_at'> & { created_at?: string }
        Update: Partial<Omit<User, 'id'>>
        Relationships: []
      }
      budgets: {
        Row: Budget
        Insert: BudgetInsert
        Update: Partial<Omit<Budget, 'id' | 'created_at'>>
        Relationships: []
      }
      budget_members: {
        Row: BudgetMember
        Insert: Omit<BudgetMember, 'id' | 'joined_at'> & { id?: string; joined_at?: string }
        Update: Partial<Pick<BudgetMember, 'role'>>
        Relationships: []
      }
      invitations: {
        Row: Invitation
        Insert: Omit<Invitation, 'id' | 'created_at' | 'expires_at' | 'status'> & {
          id?: string
          status?: InvitationStatus
          expires_at?: string
        }
        Update: Partial<Pick<Invitation, 'status'>>
        Relationships: []
      }
      categories: {
        Row: Category
        Insert: CategoryInsert
        Update: Partial<Omit<Category, 'id' | 'created_at' | 'updated_at'>>
        Relationships: []
      }
      uploads: {
        Row: Upload
        Insert: Omit<Upload, 'id' | 'created_at'> & { id?: string }
        Update: Partial<Pick<Upload, 'status' | 'row_count'>>
        Relationships: []
      }
      transactions: {
        Row: Transaction
        Insert: TransactionInsert
        Update: Partial<Omit<Transaction, 'id' | 'created_at' | 'updated_at'>>
        Relationships: []
      }
      column_mappings: {
        Row: ColumnMapping
        Insert: Omit<ColumnMapping, 'id'> & { id?: string }
        Update: Partial<Omit<ColumnMapping, 'id'>>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: {
      budget_type: BudgetType
      member_role: MemberRole
      invitation_status: InvitationStatus
      upload_status: UploadStatus
    }
  }
}
