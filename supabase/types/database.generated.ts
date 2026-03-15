export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      admin_sessions: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          invalidated_at: string | null
          session_token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          invalidated_at?: string | null
          session_token_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          invalidated_at?: string | null
          session_token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_events: {
        Row: {
          case_id: string | null
          created_at: string
          event_type: string
          id: string
          label: string
          metadata: Json
          page_title: string
          path: string
          referrer: string
          session_id: string
        }
        Insert: {
          case_id?: string | null
          created_at: string
          event_type: string
          id: string
          label?: string
          metadata?: Json
          page_title?: string
          path?: string
          referrer?: string
          session_id: string
        }
        Update: {
          case_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          label?: string
          metadata?: Json
          page_title?: string
          path?: string
          referrer?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      app_users: {
        Row: {
          created_at: string
          display_name: string
          id: string
          password_hash: string
          role: string
          status: string
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          password_hash: string
          role: string
          status?: string
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          password_hash?: string
          role?: string
          status?: string
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      case_activity: {
        Row: {
          actor_label: string
          actor_type: string
          case_id: string
          created_at: string
          event_type: string
          id: string
          metadata: Json
        }
        Insert: {
          actor_label?: string
          actor_type: string
          case_id: string
          created_at: string
          event_type: string
          id: string
          metadata?: Json
        }
        Update: {
          actor_label?: string
          actor_type?: string
          case_id?: string
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "case_activity_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_documents: {
        Row: {
          case_id: string
          content_type: string
          document_type: string
          file_name: string
          id: string
          metadata: Json
          size_bytes: number
          storage_path: string
          storage_provider: string
          uploaded_at: string
          uploaded_by_actor: string
          verified_at: string | null
        }
        Insert: {
          case_id: string
          content_type?: string
          document_type: string
          file_name: string
          id: string
          metadata?: Json
          size_bytes?: number
          storage_path: string
          storage_provider?: string
          uploaded_at: string
          uploaded_by_actor?: string
          verified_at?: string | null
        }
        Update: {
          case_id?: string
          content_type?: string
          document_type?: string
          file_name?: string
          id?: string
          metadata?: Json
          size_bytes?: number
          storage_path?: string
          storage_provider?: string
          uploaded_at?: string
          uploaded_by_actor?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_notes: {
        Row: {
          authored_by_name_snapshot: string
          authored_by_user_id: string | null
          body: string
          case_id: string
          created_at: string
          id: string
          visibility: string
        }
        Insert: {
          authored_by_name_snapshot?: string
          authored_by_user_id?: string | null
          body: string
          case_id: string
          created_at?: string
          id?: string
          visibility?: string
        }
        Update: {
          authored_by_name_snapshot?: string
          authored_by_user_id?: string | null
          body?: string
          case_id?: string
          created_at?: string
          id?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_notes_authored_by_user_id_fkey"
            columns: ["authored_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_notes_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_reminders: {
        Row: {
          assigned_to: string
          case_id: string
          completed_at: string | null
          created_at: string
          due_date: string | null
          escalate_at: string | null
          id: string
          notes: string
          owner_lane: string
          severity: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string
          case_id: string
          completed_at?: string | null
          created_at: string
          due_date?: string | null
          escalate_at?: string | null
          id: string
          notes?: string
          owner_lane?: string
          severity?: string
          status?: string
          title: string
          updated_at: string
        }
        Update: {
          assigned_to?: string
          case_id?: string
          completed_at?: string | null
          created_at?: string
          due_date?: string | null
          escalate_at?: string | null
          id?: string
          notes?: string
          owner_lane?: string
          severity?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_reminders_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          archive_reason: string
          archived_at: string | null
          archived_by_name_snapshot: string
          archived_by_user_id: string | null
          assigned_to_name_snapshot: string
          assigned_to_user_id: string | null
          authority_basis: string
          blocker_reason: string
          case_details: string
          created_at: string
          customer_id: string
          deceased_name: string
          document_notes: string
          due_date: string | null
          id: string
          intake_source: string
          internal_notes: string
          last_client_update_at: string | null
          last_operator_action_at: string | null
          legacy_payload: Json
          next_follow_up_at: string | null
          operator_lane: string
          package_label: string
          package_price_gbp: number
          package_target_days: number
          partner_account_id: string | null
          payment_status: string
          preferred_outcome: string
          priority: string
          public_token_hash: string
          public_token_hint: string
          reference: string
          referral_source: string
          relationship_to_deceased: string
          selected_package: string
          status: string
          updated_at: string
          urgency: string
        }
        Insert: {
          archive_reason?: string
          archived_at?: string | null
          archived_by_name_snapshot?: string
          archived_by_user_id?: string | null
          assigned_to_name_snapshot?: string
          assigned_to_user_id?: string | null
          authority_basis?: string
          blocker_reason?: string
          case_details?: string
          created_at: string
          customer_id: string
          deceased_name: string
          document_notes?: string
          due_date?: string | null
          id: string
          intake_source?: string
          internal_notes?: string
          last_client_update_at?: string | null
          last_operator_action_at?: string | null
          legacy_payload?: Json
          next_follow_up_at?: string | null
          operator_lane?: string
          package_label: string
          package_price_gbp?: number
          package_target_days?: number
          partner_account_id?: string | null
          payment_status: string
          preferred_outcome?: string
          priority?: string
          public_token_hash: string
          public_token_hint?: string
          reference: string
          referral_source?: string
          relationship_to_deceased?: string
          selected_package: string
          status: string
          updated_at: string
          urgency?: string
        }
        Update: {
          archive_reason?: string
          archived_at?: string | null
          archived_by_name_snapshot?: string
          archived_by_user_id?: string | null
          assigned_to_name_snapshot?: string
          assigned_to_user_id?: string | null
          authority_basis?: string
          blocker_reason?: string
          case_details?: string
          created_at?: string
          customer_id?: string
          deceased_name?: string
          document_notes?: string
          due_date?: string | null
          id?: string
          intake_source?: string
          internal_notes?: string
          last_client_update_at?: string | null
          last_operator_action_at?: string | null
          legacy_payload?: Json
          next_follow_up_at?: string | null
          operator_lane?: string
          package_label?: string
          package_price_gbp?: number
          package_target_days?: number
          partner_account_id?: string | null
          payment_status?: string
          preferred_outcome?: string
          priority?: string
          public_token_hash?: string
          public_token_hint?: string
          reference?: string
          referral_source?: string
          relationship_to_deceased?: string
          selected_package?: string
          status?: string
          updated_at?: string
          urgency?: string
        }
        Relationships: [
          {
            foreignKeyName: "cases_archived_by_user_id_fkey"
            columns: ["archived_by_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_assigned_to_user_id_fkey"
            columns: ["assigned_to_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_partner_account_id_fkey"
            columns: ["partner_account_id"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          phone: string
          relationship_to_deceased: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id?: string
          phone?: string
          relationship_to_deceased?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          phone?: string
          relationship_to_deceased?: string
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          case_id: string | null
          channel: string
          created_at: string
          direction: string
          id: string
          metadata: Json
          provider_message_id: string
          recipient_user_id: string | null
          sent_at: string | null
          status: string
          subject: string
          template_key: string
        }
        Insert: {
          body?: string
          case_id?: string | null
          channel?: string
          created_at?: string
          direction?: string
          id?: string
          metadata?: Json
          provider_message_id?: string
          recipient_user_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          template_key?: string
        }
        Update: {
          body?: string
          case_id?: string | null
          channel?: string
          created_at?: string
          direction?: string
          id?: string
          metadata?: Json
          provider_message_id?: string
          recipient_user_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          template_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_accounts: {
        Row: {
          business_name: string
          created_at: string
          email: string
          id: string
          notes: string
          partner_type: string
          phone: string
          primary_contact_name: string
          referral_fee_gbp: number
          status: string
          updated_at: string
        }
        Insert: {
          business_name: string
          created_at?: string
          email?: string
          id?: string
          notes?: string
          partner_type?: string
          phone?: string
          primary_contact_name?: string
          referral_fee_gbp?: number
          status?: string
          updated_at?: string
        }
        Update: {
          business_name?: string
          created_at?: string
          email?: string
          id?: string
          notes?: string
          partner_type?: string
          phone?: string
          primary_contact_name?: string
          referral_fee_gbp?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      payment_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          payload: Json
          payment_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          payment_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_gbp: number
          case_id: string
          created_at: string
          currency_code: string
          id: string
          metadata: Json
          paid_at: string | null
          provider: string
          provider_reference: string
          refunded_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_gbp?: number
          case_id: string
          created_at?: string
          currency_code?: string
          id?: string
          metadata?: Json
          paid_at?: string | null
          provider?: string
          provider_reference?: string
          refunded_at?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          amount_gbp?: number
          case_id?: string
          created_at?: string
          currency_code?: string
          id?: string
          metadata?: Json
          paid_at?: string | null
          provider?: string
          provider_reference?: string
          refunded_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_tasks: {
        Row: {
          case_id: string
          created_at: string
          evidence_needed: string
          external_key: string
          id: string
          last_updated_at: string
          notes: string
          outcome_requested: string
          platform_name: string
          profile_or_handle: string
          resolved_at: string | null
          sort_order: number
          status: string
          submission_reference: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          case_id: string
          created_at?: string
          evidence_needed?: string
          external_key: string
          id?: string
          last_updated_at?: string
          notes?: string
          outcome_requested?: string
          platform_name: string
          profile_or_handle?: string
          resolved_at?: string | null
          sort_order?: number
          status?: string
          submission_reference?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          case_id?: string
          created_at?: string
          evidence_needed?: string
          external_key?: string
          id?: string
          last_updated_at?: string
          notes?: string
          outcome_requested?: string
          platform_name?: string
          profile_or_handle?: string
          resolved_at?: string | null
          sort_order?: number
          status?: string
          submission_reference?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_tasks_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      reporting_case_queue_metrics: {
        Row: {
          active_case_count: number | null
          case_count: number | null
          payment_status: string | null
          priority: string | null
          status: string | null
        }
        Relationships: []
      }
      reporting_funnel_daily: {
        Row: {
          event_count: number | null
          event_day: string | null
          event_type: string | null
        }
        Relationships: []
      }
      reporting_partner_conversion: {
        Row: {
          completed_cases: number | null
          paid_cases: number | null
          partner_name: string | null
          partner_type: string | null
          total_cases: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
