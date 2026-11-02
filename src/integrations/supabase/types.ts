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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      ai_call_logs: {
        Row: {
          created_at: string
          error: string | null
          goal_id: string | null
          id: string
          mode: string
          model: string
          ok: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          goal_id?: string | null
          id?: string
          mode: string
          model: string
          ok: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          goal_id?: string | null
          id?: string
          mode?: string
          model?: string
          ok?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_call_logs_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_plans: {
        Row: {
          created_at: string
          data: Json
          goal_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          data: Json
          goal_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          goal_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_plans_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: true
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_check_results: {
        Row: {
          answers: Json
          created_at: string
          goal_id: string
          id: string
          passed: boolean
          user_id: string
        }
        Insert: {
          answers: Json
          created_at?: string
          goal_id: string
          id?: string
          passed: boolean
          user_id: string
        }
        Update: {
          answers?: Json
          created_at?: string
          goal_id?: string
          id?: string
          passed?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_check_results_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_steps: {
        Row: {
          acknowledged: boolean
          actions: Json
          done: boolean
          done_at: string | null
          goal_id: string
          hint: string
          minutes: number
          override_offered: boolean
          position: number
          recap: string | null
          safety: string | null
          step_key: string
          stuck_count: number
          timer_done_posted: boolean
          timer_started_at: string | null
          title: string
          user_id: string
          wait_seconds: number | null
          why: string
        }
        Insert: {
          acknowledged?: boolean
          actions?: Json
          done?: boolean
          done_at?: string | null
          goal_id: string
          hint?: string
          minutes: number
          override_offered?: boolean
          position: number
          recap?: string | null
          safety?: string | null
          step_key: string
          stuck_count?: number
          timer_done_posted?: boolean
          timer_started_at?: string | null
          title: string
          user_id: string
          wait_seconds?: number | null
          why?: string
        }
        Update: {
          acknowledged?: boolean
          actions?: Json
          done?: boolean
          done_at?: string | null
          goal_id?: string
          hint?: string
          minutes?: number
          override_offered?: boolean
          position?: number
          recap?: string | null
          safety?: string | null
          step_key?: string
          stuck_count?: number
          timer_done_posted?: boolean
          timer_started_at?: string | null
          title?: string
          user_id?: string
          wait_seconds?: number | null
          why?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_steps_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          achieved: boolean
          case_data: Json | null
          check_def: Json | null
          created_at: string
          custom: boolean
          done_means: string | null
          goal_text: string | null
          id: string
          intake: Json
          paused: boolean
          planned: boolean
          replan_count: number
          seq: number
          started: boolean
          template_id: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          achieved?: boolean
          case_data?: Json | null
          check_def?: Json | null
          created_at?: string
          custom?: boolean
          done_means?: string | null
          goal_text?: string | null
          id?: string
          intake?: Json
          paused?: boolean
          planned?: boolean
          replan_count?: number
          seq?: number
          started?: boolean
          template_id?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          achieved?: boolean
          case_data?: Json | null
          check_def?: Json | null
          created_at?: string
          custom?: boolean
          done_means?: string | null
          goal_text?: string | null
          id?: string
          intake?: Json
          paused?: boolean
          planned?: boolean
          replan_count?: number
          seq?: number
          started?: boolean
          template_id?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "plan_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string | null
          created_at: string
          goal_id: string
          kind: string
          role: string
          seq: number
          step_ids: Json | null
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          goal_id: string
          kind: string
          role: string
          seq: number
          step_ids?: Json | null
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          goal_id?: string
          kind?: string
          role?: string
          seq?: number
          step_ids?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_checks: {
        Row: {
          created_at: string
          goal_id: string
          id: string
          missing_items: Json
          reason: string
          step_key: string
          user_id: string
          verdict: string
        }
        Insert: {
          created_at?: string
          goal_id: string
          id?: string
          missing_items?: Json
          reason?: string
          step_key: string
          user_id: string
          verdict: string
        }
        Update: {
          created_at?: string
          goal_id?: string
          id?: string
          missing_items?: Json
          reason?: string
          step_key?: string
          user_id?: string
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_checks_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_patches: {
        Row: {
          created_at: string
          goal_id: string
          id: string
          patch: Json
          status: string
          summary: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          goal_id: string
          id?: string
          patch: Json
          status?: string
          summary: Json
          user_id: string
        }
        Update: {
          created_at?: string
          goal_id?: string
          id?: string
          patch?: Json
          status?: string
          summary?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_patches_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_revisions: {
        Row: {
          created_at: string
          goal_id: string
          id: string
          patch_id: string | null
          plan: Json
          restored: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          goal_id: string
          id?: string
          patch_id?: string | null
          plan: Json
          restored?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          goal_id?: string
          id?: string
          patch_id?: string | null
          plan?: Json
          restored?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_revisions_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_revisions_patch_id_fkey"
            columns: ["patch_id"]
            isOneToOne: false
            referencedRelation: "plan_patches"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_templates: {
        Row: {
          created_at: string
          data: Json
          id: string
        }
        Insert: {
          created_at?: string
          data: Json
          id: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
        }
        Relationships: []
      }
      proof_items: {
        Row: {
          goal_id: string
          item_key: string
          kind: string
          label: string
          max_value: number | null
          min_value: number | null
          position: number
          step_key: string
          user_id: string
        }
        Insert: {
          goal_id: string
          item_key: string
          kind: string
          label: string
          max_value?: number | null
          min_value?: number | null
          position: number
          step_key: string
          user_id: string
        }
        Update: {
          goal_id?: string
          item_key?: string
          kind?: string
          label?: string
          max_value?: number | null
          min_value?: number | null
          position?: number
          step_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proof_items_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      proof_overrides: {
        Row: {
          created_at: string
          goal_id: string
          reason: string
          step_key: string
          user_id: string
        }
        Insert: {
          created_at?: string
          goal_id: string
          reason: string
          step_key: string
          user_id: string
        }
        Update: {
          created_at?: string
          goal_id?: string
          reason?: string
          step_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "proof_overrides_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      proof_submissions: {
        Row: {
          goal_id: string
          item_key: string
          step_key: string
          submitted_at: string
          user_id: string
          value: Json
        }
        Insert: {
          goal_id: string
          item_key: string
          step_key: string
          submitted_at?: string
          user_id: string
          value: Json
        }
        Update: {
          goal_id?: string
          item_key?: string
          step_key?: string
          submitted_at?: string
          user_id?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "proof_submissions_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      step_prereqs: {
        Row: {
          goal_id: string
          prereq_key: string
          step_key: string
          user_id: string
        }
        Insert: {
          goal_id: string
          prereq_key: string
          step_key: string
          user_id: string
        }
        Update: {
          goal_id?: string
          prereq_key?: string
          step_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "step_prereqs_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
