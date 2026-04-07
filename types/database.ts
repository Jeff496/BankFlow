/**
 * Hand-written Database type in the @supabase/supabase-js shape.
 * Replace with `supabase gen types typescript` output once the Supabase CLI
 * is wired up — until then, keep this in sync with migrations/*.sql by hand.
 */

export type BudgetType = "personal" | "group";
export type BudgetRole = "owner" | "editor" | "viewer";
export type InvitationStatus = "pending" | "accepted" | "declined";
export type UploadStatus = "processing" | "complete" | "failed";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Internal discriminator consumed by @supabase/postgrest-js to pick query-
  // builder overloads. Match whatever version Supabase CLI emits.
  __InternalSupabase: {
    PostgrestVersion: "12";
  };
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          display_name?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      budgets: {
        Row: {
          id: string;
          name: string;
          type: BudgetType;
          owner_id: string;
          sheet_id: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
          sync_started_at: string | null;
          sheet_last_synced_at: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          type: BudgetType;
          owner_id: string;
          sheet_id?: string | null;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
          sync_started_at?: string | null;
          sheet_last_synced_at?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          type?: BudgetType;
          owner_id?: string;
          sheet_id?: string | null;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
          sync_started_at?: string | null;
          sheet_last_synced_at?: string | null;
        };
        Relationships: [];
      };
      budget_members: {
        Row: {
          id: string;
          budget_id: string;
          user_id: string;
          role: BudgetRole;
          joined_at: string;
        };
        Insert: {
          id?: string;
          budget_id: string;
          user_id: string;
          role: BudgetRole;
          joined_at?: string;
        };
        Update: {
          id?: string;
          budget_id?: string;
          user_id?: string;
          role?: BudgetRole;
          joined_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "budget_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "budget_members_budget_id_fkey";
            columns: ["budget_id"];
            isOneToOne: false;
            referencedRelation: "budgets";
            referencedColumns: ["id"];
          },
        ];
      };
      invitations: {
        Row: {
          id: string;
          budget_id: string;
          invited_by: string;
          email: string;
          role: BudgetRole;
          status: InvitationStatus;
          created_at: string;
          expires_at: string;
        };
        Insert: {
          id?: string;
          budget_id: string;
          invited_by: string;
          email: string;
          role: BudgetRole;
          status?: InvitationStatus;
          created_at?: string;
          expires_at?: string;
        };
        Update: {
          id?: string;
          budget_id?: string;
          invited_by?: string;
          email?: string;
          role?: BudgetRole;
          status?: InvitationStatus;
          created_at?: string;
          expires_at?: string;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          id: string;
          budget_id: string;
          name: string;
          type: string; // 'expense' | 'income'
          excluded: boolean;
          monthly_limit: string | null; // numeric → string in PostgREST
          keywords: string[];
          color: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          budget_id: string;
          name: string;
          type?: string;
          excluded?: boolean;
          monthly_limit?: string | number | null;
          keywords?: string[];
          color?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          budget_id?: string;
          name?: string;
          type?: string;
          excluded?: boolean;
          monthly_limit?: string | number | null;
          keywords?: string[];
          color?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      uploads: {
        Row: {
          id: string;
          budget_id: string;
          uploaded_by: string;
          filename: string;
          row_count: number;
          status: UploadStatus;
          created_at: string;
        };
        Insert: {
          id?: string;
          budget_id: string;
          uploaded_by: string;
          filename: string;
          row_count?: number;
          status?: UploadStatus;
          created_at?: string;
        };
        Update: {
          id?: string;
          budget_id?: string;
          uploaded_by?: string;
          filename?: string;
          row_count?: number;
          status?: UploadStatus;
          created_at?: string;
        };
        Relationships: [];
      };
      transactions: {
        Row: {
          id: string;
          budget_id: string;
          upload_id: string;
          uploaded_by: string;
          date: string; // YYYY-MM-DD
          description: string;
          amount: string; // numeric → string in PostgREST
          category_id: string | null;
          excluded: boolean;
          hash: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          budget_id: string;
          upload_id: string;
          uploaded_by: string;
          date: string;
          description: string;
          amount: string | number;
          category_id?: string | null;
          excluded?: boolean;
          hash: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          budget_id?: string;
          upload_id?: string;
          uploaded_by?: string;
          date?: string;
          description?: string;
          amount?: string | number;
          category_id?: string | null;
          excluded?: boolean;
          hash?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      column_mappings: {
        Row: {
          id: string;
          user_id: string;
          bank_name: string;
          mapping: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          bank_name: string;
          mapping: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          bank_name?: string;
          mapping?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      current_user_uid: {
        Args: Record<string, never>;
        Returns: string;
      };
      debug_session_info: {
        Args: Record<string, never>;
        Returns: Json;
      };
      debug_try_insert_budget: {
        Args: Record<string, never>;
        Returns: Json;
      };
      is_budget_member: {
        Args: { p_budget_id: string; p_user_id: string };
        Returns: boolean;
      };
      is_budget_owner: {
        Args: { p_budget_id: string; p_user_id: string };
        Returns: boolean;
      };
      is_budget_writer: {
        Args: { p_budget_id: string; p_user_id: string };
        Returns: boolean;
      };
      are_budget_peers: {
        Args: { p_user_a: string; p_user_b: string };
        Returns: boolean;
      };
      accept_invitation: {
        Args: { p_invitation_id: string };
        Returns: Json;
      };
      decline_invitation: {
        Args: { p_invitation_id: string };
        Returns: Json;
      };
      list_my_pending_invitations: {
        Args: Record<string, never>;
        Returns: Array<{
          invitation_id: string;
          budget_id: string;
          budget_name: string;
          budget_type: BudgetType;
          invited_by: string;
          inviter_name: string | null;
          role: BudgetRole;
          expires_at: string;
          created_at: string;
        }>;
      };
    };
    Enums: {
      budget_type: BudgetType;
      budget_role: BudgetRole;
      invitation_status: InvitationStatus;
      upload_status: UploadStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};

/** Convenience row aliases. */
export type UserRow = Database["public"]["Tables"]["users"]["Row"];
export type BudgetRow = Database["public"]["Tables"]["budgets"]["Row"];
export type BudgetMemberRow = Database["public"]["Tables"]["budget_members"]["Row"];
export type InvitationRow = Database["public"]["Tables"]["invitations"]["Row"];
export type CategoryRow = Database["public"]["Tables"]["categories"]["Row"];
export type UploadRow = Database["public"]["Tables"]["uploads"]["Row"];
export type TransactionRow = Database["public"]["Tables"]["transactions"]["Row"];
export type ColumnMappingRow = Database["public"]["Tables"]["column_mappings"]["Row"];
