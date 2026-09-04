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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          canvas_id: string | null
          created_at: string
          details: Json | null
          feedback_item_id: string | null
          guest_name: string | null
          id: string
          project_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          canvas_id?: string | null
          created_at?: string
          details?: Json | null
          feedback_item_id?: string | null
          guest_name?: string | null
          id?: string
          project_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          canvas_id?: string | null
          created_at?: string
          details?: Json | null
          feedback_item_id?: string | null
          guest_name?: string | null
          id?: string
          project_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_canvas_id_fkey"
            columns: ["canvas_id"]
            isOneToOne: false
            referencedRelation: "canvases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_feedback_item_id_fkey"
            columns: ["feedback_item_id"]
            isOneToOne: false
            referencedRelation: "feedback_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      canvas_files: {
        Row: {
          canvas_id: string
          created_at: string
          created_by: string | null
          file_size: number
          height: number | null
          id: string
          mime_type: string
          original_filename: string | null
          page_count: number | null
          public_url: string | null
          storage_path: string
          width: number | null
        }
        Insert: {
          canvas_id: string
          created_at?: string
          created_by?: string | null
          file_size: number
          height?: number | null
          id?: string
          mime_type: string
          original_filename?: string | null
          page_count?: number | null
          public_url?: string | null
          storage_path: string
          width?: number | null
        }
        Update: {
          canvas_id?: string
          created_at?: string
          created_by?: string | null
          file_size?: number
          height?: number | null
          id?: string
          mime_type?: string
          original_filename?: string | null
          page_count?: number | null
          public_url?: string | null
          storage_path?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "canvas_files_canvas_id_fkey"
            columns: ["canvas_id"]
            isOneToOne: false
            referencedRelation: "canvases"
            referencedColumns: ["id"]
          },
        ]
      }
      canvases: {
        Row: {
          allow_approval: boolean
          allow_guest_replies: boolean
          allow_public_comment_view: boolean
          capture_screenshot: boolean
          client_id: string | null
          commenting_enabled: boolean
          created_at: string
          created_by: string | null
          feedback_deadline: string | null
          file_url: string | null
          id: string
          name: string
          project_id: string
          proxy_enabled: boolean
          public_key: string
          require_guest_email: boolean
          require_guest_name: boolean
          share_token: string
          staging_url: string | null
          status: Database["public"]["Enums"]["canvas_status"]
          type: Database["public"]["Enums"]["canvas_type"]
          updated_at: string
          website_url: string | null
          widget_fallback_enabled: boolean
        }
        Insert: {
          allow_approval?: boolean
          allow_guest_replies?: boolean
          allow_public_comment_view?: boolean
          capture_screenshot?: boolean
          client_id?: string | null
          commenting_enabled?: boolean
          created_at?: string
          created_by?: string | null
          feedback_deadline?: string | null
          file_url?: string | null
          id?: string
          name: string
          project_id: string
          proxy_enabled?: boolean
          public_key?: string
          require_guest_email?: boolean
          require_guest_name?: boolean
          share_token?: string
          staging_url?: string | null
          status?: Database["public"]["Enums"]["canvas_status"]
          type?: Database["public"]["Enums"]["canvas_type"]
          updated_at?: string
          website_url?: string | null
          widget_fallback_enabled?: boolean
        }
        Update: {
          allow_approval?: boolean
          allow_guest_replies?: boolean
          allow_public_comment_view?: boolean
          capture_screenshot?: boolean
          client_id?: string | null
          commenting_enabled?: boolean
          created_at?: string
          created_by?: string | null
          feedback_deadline?: string | null
          file_url?: string | null
          id?: string
          name?: string
          project_id?: string
          proxy_enabled?: boolean
          public_key?: string
          require_guest_email?: boolean
          require_guest_name?: boolean
          share_token?: string
          staging_url?: string | null
          status?: Database["public"]["Enums"]["canvas_status"]
          type?: Database["public"]["Enums"]["canvas_type"]
          updated_at?: string
          website_url?: string | null
          widget_fallback_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "canvases_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canvases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          archived: boolean
          company_name: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
          website_url: string | null
        }
        Insert: {
          archived?: boolean
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Update: {
          archived?: boolean
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
          website_url?: string | null
        }
        Relationships: []
      }
      feedback_comments: {
        Row: {
          body: string
          created_at: string
          deleted_at: string | null
          deleted_by_type: string | null
          deleted_by_user_id: string | null
          feedback_item_id: string
          guest_email: string | null
          guest_name: string | null
          guest_token: string | null
          id: string
          is_internal: boolean
          updated_at: string
          user_id: string | null
        }
        Insert: {
          body: string
          created_at?: string
          deleted_at?: string | null
          deleted_by_type?: string | null
          deleted_by_user_id?: string | null
          feedback_item_id: string
          guest_email?: string | null
          guest_name?: string | null
          guest_token?: string | null
          id?: string
          is_internal?: boolean
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by_type?: string | null
          deleted_by_user_id?: string | null
          feedback_item_id?: string
          guest_email?: string | null
          guest_name?: string | null
          guest_token?: string | null
          id?: string
          is_internal?: boolean
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_comments_feedback_item_id_fkey"
            columns: ["feedback_item_id"]
            isOneToOne: false
            referencedRelation: "feedback_items"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_items: {
        Row: {
          anchor_selector: string | null
          anchor_x_percent: number | null
          anchor_y_percent: number | null
          assigned_to: string | null
          browser: string | null
          browser_version: string | null
          canvas_id: string
          canvas_type: Database["public"]["Enums"]["canvas_type"]
          category: Database["public"]["Enums"]["feedback_category"]
          client_id: string | null
          closed_at: string | null
          comment: string
          created_at: string
          created_by_type: string
          created_by_user_id: string | null
          deleted_at: string | null
          deleted_by_type: string | null
          deleted_by_user_id: string | null
          device_pixel_ratio: number | null
          device_type: string | null
          element_classes: string | null
          element_href: string | null
          element_id: string | null
          element_selector: string | null
          element_src: string | null
          element_tag: string | null
          element_text: string | null
          guest_email: string | null
          guest_name: string | null
          guest_token: string | null
          id: string
          is_internal: boolean
          operating_system: string | null
          original_page_url: string | null
          original_text: string | null
          page_title: string | null
          pdf_page_number: number | null
          pin_number: number | null
          priority: Database["public"]["Enums"]["feedback_priority"]
          project_id: string
          proxied_page_url: string | null
          resolved_at: string | null
          screen_height: number | null
          screen_width: number | null
          screenshot_error: string | null
          screenshot_status: string
          screenshot_url: string | null
          scroll_x: number | null
          scroll_y: number | null
          status: Database["public"]["Enums"]["feedback_status"]
          suggested_text: string | null
          updated_at: string
          user_agent: string | null
          viewport_height: number | null
          viewport_width: number | null
          visibility: string
          x_percent: number | null
          x_position: number | null
          y_percent: number | null
          y_position: number | null
        }
        Insert: {
          anchor_selector?: string | null
          anchor_x_percent?: number | null
          anchor_y_percent?: number | null
          assigned_to?: string | null
          browser?: string | null
          browser_version?: string | null
          canvas_id: string
          canvas_type?: Database["public"]["Enums"]["canvas_type"]
          category?: Database["public"]["Enums"]["feedback_category"]
          client_id?: string | null
          closed_at?: string | null
          comment: string
          created_at?: string
          created_by_type?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          deleted_by_type?: string | null
          deleted_by_user_id?: string | null
          device_pixel_ratio?: number | null
          device_type?: string | null
          element_classes?: string | null
          element_href?: string | null
          element_id?: string | null
          element_selector?: string | null
          element_src?: string | null
          element_tag?: string | null
          element_text?: string | null
          guest_email?: string | null
          guest_name?: string | null
          guest_token?: string | null
          id?: string
          is_internal?: boolean
          operating_system?: string | null
          original_page_url?: string | null
          original_text?: string | null
          page_title?: string | null
          pdf_page_number?: number | null
          pin_number?: number | null
          priority?: Database["public"]["Enums"]["feedback_priority"]
          project_id: string
          proxied_page_url?: string | null
          resolved_at?: string | null
          screen_height?: number | null
          screen_width?: number | null
          screenshot_error?: string | null
          screenshot_status?: string
          screenshot_url?: string | null
          scroll_x?: number | null
          scroll_y?: number | null
          status?: Database["public"]["Enums"]["feedback_status"]
          suggested_text?: string | null
          updated_at?: string
          user_agent?: string | null
          viewport_height?: number | null
          viewport_width?: number | null
          visibility?: string
          x_percent?: number | null
          x_position?: number | null
          y_percent?: number | null
          y_position?: number | null
        }
        Update: {
          anchor_selector?: string | null
          anchor_x_percent?: number | null
          anchor_y_percent?: number | null
          assigned_to?: string | null
          browser?: string | null
          browser_version?: string | null
          canvas_id?: string
          canvas_type?: Database["public"]["Enums"]["canvas_type"]
          category?: Database["public"]["Enums"]["feedback_category"]
          client_id?: string | null
          closed_at?: string | null
          comment?: string
          created_at?: string
          created_by_type?: string
          created_by_user_id?: string | null
          deleted_at?: string | null
          deleted_by_type?: string | null
          deleted_by_user_id?: string | null
          device_pixel_ratio?: number | null
          device_type?: string | null
          element_classes?: string | null
          element_href?: string | null
          element_id?: string | null
          element_selector?: string | null
          element_src?: string | null
          element_tag?: string | null
          element_text?: string | null
          guest_email?: string | null
          guest_name?: string | null
          guest_token?: string | null
          id?: string
          is_internal?: boolean
          operating_system?: string | null
          original_page_url?: string | null
          original_text?: string | null
          page_title?: string | null
          pdf_page_number?: number | null
          pin_number?: number | null
          priority?: Database["public"]["Enums"]["feedback_priority"]
          project_id?: string
          proxied_page_url?: string | null
          resolved_at?: string | null
          screen_height?: number | null
          screen_width?: number | null
          screenshot_error?: string | null
          screenshot_status?: string
          screenshot_url?: string | null
          scroll_x?: number | null
          scroll_y?: number | null
          status?: Database["public"]["Enums"]["feedback_status"]
          suggested_text?: string | null
          updated_at?: string
          user_agent?: string | null
          viewport_height?: number | null
          viewport_width?: number | null
          visibility?: string
          x_percent?: number | null
          x_position?: number | null
          y_percent?: number | null
          y_position?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_items_canvas_id_fkey"
            columns: ["canvas_id"]
            isOneToOne: false
            referencedRelation: "canvases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_labels: {
        Row: {
          created_at: string
          created_by: string | null
          feedback_item_id: string
          label_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          feedback_item_id: string
          label_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          feedback_item_id?: string
          label_id?: string
        }
        Relationships: []
      }
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          revoked_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          revoked_at?: string | null
          role: Database["public"]["Enums"]["app_role"]
          token?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          token?: string
          updated_at?: string
        }
        Relationships: []
      }
      permissions: {
        Row: {
          category: string
          description: string
          is_locked: boolean
          key: string
          label: string
          sort_order: number
        }
        Insert: {
          category: string
          description: string
          is_locked?: boolean
          key: string
          label: string
          sort_order: number
        }
        Update: {
          category?: string
          description?: string
          is_locked?: boolean
          key?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      role_permissions: {
        Row: {
          allowed: boolean
          permission: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allowed?: boolean
          permission: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allowed?: boolean
          permission?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_fkey"
            columns: ["permission"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["key"]
          },
        ]
      }
      labels: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          actor_id: string | null
          body: string | null
          created_at: string
          feedback_item_id: string | null
          id: string
          kind: string
          project_id: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          body?: string | null
          created_at?: string
          feedback_item_id?: string | null
          id?: string
          kind: string
          project_id?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          body?: string | null
          created_at?: string
          feedback_item_id?: string | null
          id?: string
          kind?: string
          project_id?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_feedback_item_id_fkey"
            columns: ["feedback_item_id"]
            isOneToOne: false
            referencedRelation: "feedback_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      review_decisions: {
        Row: {
          addressed_at: string | null
          addressed_by: string | null
          addressed_note: string | null
          canvas_id: string
          client_id: string | null
          created_at: string
          decision: Database["public"]["Enums"]["review_decision_type"]
          id: string
          message: string | null
          project_id: string
          reviewer_email: string | null
          reviewer_name: string | null
          share_token: string | null
        }
        Insert: {
          addressed_at?: string | null
          addressed_by?: string | null
          addressed_note?: string | null
          canvas_id: string
          client_id?: string | null
          created_at?: string
          decision: Database["public"]["Enums"]["review_decision_type"]
          id?: string
          message?: string | null
          project_id: string
          reviewer_email?: string | null
          reviewer_name?: string | null
          share_token?: string | null
        }
        Update: {
          addressed_at?: string | null
          addressed_by?: string | null
          addressed_note?: string | null
          canvas_id?: string
          client_id?: string | null
          created_at?: string
          decision?: Database["public"]["Enums"]["review_decision_type"]
          id?: string
          message?: string | null
          project_id?: string
          reviewer_email?: string | null
          reviewer_name?: string | null
          share_token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_decisions_canvas_id_fkey"
            columns: ["canvas_id"]
            isOneToOne: false
            referencedRelation: "canvases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_decisions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_decisions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_manage: { Args: { _user_id: string }; Returns: boolean }
      get_invitation_by_token: {
        Args: { _token: string }
        Returns: {
          email: string
          role: Database["public"]["Enums"]["app_role"]
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_team_member: { Args: { _user_id: string }; Returns: boolean }
      has_permission: {
        Args: { _permission: string; _user_id: string }
        Returns: boolean
      }
      my_permissions: { Args: Record<string, never>; Returns: string[] }
      default_role_permissions: {
        Args: Record<string, never>
        Returns: {
          allowed: boolean
          permission: string
          role: Database["public"]["Enums"]["app_role"]
        }[]
      }
    }
    Enums: {
      app_role: "owner" | "admin" | "consultant" | "developer" | "qa" | "viewer"
      canvas_status: "active" | "paused" | "completed" | "archived"
      canvas_type: "website" | "image" | "pdf" | "screenshot"
      feedback_category:
        | "general"
        | "design"
        | "content"
        | "bug"
        | "mobile"
        | "seo"
        | "form"
        | "performance"
        | "other"
      feedback_priority: "low" | "normal" | "high" | "urgent"
      feedback_status:
        | "new"
        | "in_review"
        | "assigned"
        | "in_progress"
        | "ready_for_qa"
        | "changes_needed"
        | "resolved"
        | "closed"
      review_decision_type: "approved" | "changes_requested"
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
    Enums: {
      app_role: ["owner", "admin", "consultant", "developer", "qa", "viewer"],
      canvas_status: ["active", "paused", "completed", "archived"],
      canvas_type: ["website", "image", "pdf", "screenshot"],
      feedback_category: [
        "general",
        "design",
        "content",
        "bug",
        "mobile",
        "seo",
        "form",
        "performance",
        "other",
      ],
      feedback_priority: ["low", "normal", "high", "urgent"],
      feedback_status: [
        "new",
        "in_review",
        "assigned",
        "in_progress",
        "ready_for_qa",
        "changes_needed",
        "resolved",
        "closed",
      ],
      review_decision_type: ["approved", "changes_requested"],
    },
  },
} as const
