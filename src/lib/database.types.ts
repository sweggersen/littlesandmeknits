export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      auth_identities: {
        Row: {
          created_at: string
          id: string
          phone: string | null
          provider: string
          sub: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          phone?: string | null
          provider: string
          sub: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          phone?: string | null
          provider?: string
          sub?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auth_identities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      buyer_preferences: {
        Row: {
          created_at: string
          id: string
          marketplace_interests: string[] | null
          strikketorget_welcomed_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          marketplace_interests?: string[] | null
          strikketorget_welcomed_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          marketplace_interests?: string[] | null
          strikketorget_welcomed_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "buyer_preferences_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_offers: {
        Row: {
          created_at: string
          id: string
          knitter_id: string
          message: string
          price_nok: number
          project_id: string | null
          request_id: string
          status: Database["public"]["Enums"]["commission_offer_status"]
          turnaround_weeks: number
        }
        Insert: {
          created_at?: string
          id?: string
          knitter_id: string
          message: string
          price_nok: number
          project_id?: string | null
          request_id: string
          status?: Database["public"]["Enums"]["commission_offer_status"]
          turnaround_weeks: number
        }
        Update: {
          created_at?: string
          id?: string
          knitter_id?: string
          message?: string
          price_nok?: number
          project_id?: string | null
          request_id?: string
          status?: Database["public"]["Enums"]["commission_offer_status"]
          turnaround_weeks?: number
        }
        Relationships: [
          {
            foreignKeyName: "commission_offers_knitter_id_fkey"
            columns: ["knitter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_offers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_offers_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "commission_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_requests: {
        Row: {
          auto_release_at: string | null
          awarded_offer_id: string | null
          budget_nok_max: number
          budget_nok_min: number
          buyer_id: string
          category: Database["public"]["Enums"]["listing_category"]
          colorway: string | null
          completed_at: string | null
          created_at: string
          delivered_at: string | null
          description: string | null
          dispute_reason: string | null
          dispute_resolution: string | null
          dispute_resolved_at: string | null
          disputed_at: string | null
          expires_at: string
          favorite_count: number
          finished_item_tracking_code: string | null
          id: string
          label_free_code: string | null
          last_nudge_sent_at: string | null
          moderation_notes: string | null
          needed_by: string | null
          offer_count: number
          pattern_external_title: string | null
          pattern_slug: string | null
          platform_fee_nok: number | null
          report_count: number
          review_deadline_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          search_vector: unknown
          shipping_price_nok: number | null
          size_age_months_max: number | null
          size_age_months_min: number | null
          size_label: string
          status: Database["public"]["Enums"]["commission_request_status"]
          stripe_dispute_id: string | null
          stripe_payment_intent_id: string | null
          stripe_transfer_id: string | null
          target_knitter_id: string | null
          title: string
          updated_at: string
          yarn_bring_shipment_number: string | null
          yarn_preference: string | null
          yarn_provided_by_buyer: boolean
          yarn_received_at: string | null
          yarn_shipped_at: string | null
          yarn_tracking_code: string | null
        }
        Insert: {
          auto_release_at?: string | null
          awarded_offer_id?: string | null
          budget_nok_max: number
          budget_nok_min: number
          buyer_id: string
          category: Database["public"]["Enums"]["listing_category"]
          colorway?: string | null
          completed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          description?: string | null
          dispute_reason?: string | null
          dispute_resolution?: string | null
          dispute_resolved_at?: string | null
          disputed_at?: string | null
          expires_at?: string
          favorite_count?: number
          finished_item_tracking_code?: string | null
          id?: string
          label_free_code?: string | null
          last_nudge_sent_at?: string | null
          moderation_notes?: string | null
          needed_by?: string | null
          offer_count?: number
          pattern_external_title?: string | null
          pattern_slug?: string | null
          platform_fee_nok?: number | null
          report_count?: number
          review_deadline_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          search_vector?: unknown
          shipping_price_nok?: number | null
          size_age_months_max?: number | null
          size_age_months_min?: number | null
          size_label: string
          status?: Database["public"]["Enums"]["commission_request_status"]
          stripe_dispute_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          target_knitter_id?: string | null
          title: string
          updated_at?: string
          yarn_bring_shipment_number?: string | null
          yarn_preference?: string | null
          yarn_provided_by_buyer?: boolean
          yarn_received_at?: string | null
          yarn_shipped_at?: string | null
          yarn_tracking_code?: string | null
        }
        Update: {
          auto_release_at?: string | null
          awarded_offer_id?: string | null
          budget_nok_max?: number
          budget_nok_min?: number
          buyer_id?: string
          category?: Database["public"]["Enums"]["listing_category"]
          colorway?: string | null
          completed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          description?: string | null
          dispute_reason?: string | null
          dispute_resolution?: string | null
          dispute_resolved_at?: string | null
          disputed_at?: string | null
          expires_at?: string
          favorite_count?: number
          finished_item_tracking_code?: string | null
          id?: string
          label_free_code?: string | null
          last_nudge_sent_at?: string | null
          moderation_notes?: string | null
          needed_by?: string | null
          offer_count?: number
          pattern_external_title?: string | null
          pattern_slug?: string | null
          platform_fee_nok?: number | null
          report_count?: number
          review_deadline_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          search_vector?: unknown
          shipping_price_nok?: number | null
          size_age_months_max?: number | null
          size_age_months_min?: number | null
          size_label?: string
          status?: Database["public"]["Enums"]["commission_request_status"]
          stripe_dispute_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_transfer_id?: string | null
          target_knitter_id?: string | null
          title?: string
          updated_at?: string
          yarn_bring_shipment_number?: string | null
          yarn_preference?: string | null
          yarn_provided_by_buyer?: boolean
          yarn_received_at?: string | null
          yarn_shipped_at?: string | null
          yarn_tracking_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commission_requests_awarded_offer_fkey"
            columns: ["awarded_offer_id"]
            isOneToOne: false
            referencedRelation: "commission_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_requests_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_requests_target_knitter_id_fkey"
            columns: ["target_knitter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dead_letter_events: {
        Row: {
          context: Json
          error: string
          id: string
          occurred_at: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          service: string
          user_id: string | null
        }
        Insert: {
          context?: Json
          error: string
          id?: string
          occurred_at?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          service: string
          user_id?: string | null
        }
        Update: {
          context?: Json
          error?: string
          id?: string
          occurred_at?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          service?: string
          user_id?: string | null
        }
        Relationships: []
      }
      external_patterns: {
        Row: {
          cover_path: string | null
          created_at: string
          designer: string | null
          file_path: string | null
          id: string
          notes: string | null
          source_url: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cover_path?: string | null
          created_at?: string
          designer?: string | null
          file_path?: string | null
          id?: string
          notes?: string | null
          source_url?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cover_path?: string | null
          created_at?: string
          designer?: string | null
          file_path?: string | null
          id?: string
          notes?: string | null
          source_url?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      favorites: {
        Row: {
          created_at: string
          id: string
          item_id: string
          item_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          item_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          item_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_impressions: {
        Row: {
          clicked: boolean
          clicked_at: string | null
          created_at: string
          id: string
          listing_id: string
          position: number | null
          promoted: boolean
          source: string
          tier: string | null
          viewer_id: string | null
        }
        Insert: {
          clicked?: boolean
          clicked_at?: string | null
          created_at?: string
          id?: string
          listing_id: string
          position?: number | null
          promoted?: boolean
          source: string
          tier?: string | null
          viewer_id?: string | null
        }
        Update: {
          clicked?: boolean
          clicked_at?: string | null
          created_at?: string
          id?: string
          listing_id?: string
          position?: number | null
          promoted?: boolean
          source?: string
          tier?: string | null
          viewer_id?: string | null
        }
        Relationships: []
      }
      listing_photos: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          listing_id: string
          path: string
          position: number
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          listing_id: string
          path: string
          position?: number
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          listing_id?: string
          path?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "listing_photos_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_promotions: {
        Row: {
          created_at: string
          daily_budget: number
          daily_impressions_served: number
          daily_window_start: string
          ends_at: string
          id: string
          listing_id: string
          price_nok: number
          seller_id: string
          starts_at: string
          status: string
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          tier: string
        }
        Insert: {
          created_at?: string
          daily_budget?: number
          daily_impressions_served?: number
          daily_window_start?: string
          ends_at: string
          id?: string
          listing_id: string
          price_nok: number
          seller_id: string
          starts_at?: string
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          tier: string
        }
        Update: {
          created_at?: string
          daily_budget?: number
          daily_impressions_served?: number
          daily_window_start?: string
          ends_at?: string
          id?: string
          listing_id?: string
          price_nok?: number
          seller_id?: string
          starts_at?: string
          status?: string
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_promotions_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_promotions_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          buyer_id: string | null
          can_meet: boolean
          category: Database["public"]["Enums"]["listing_category"]
          colorway: string | null
          condition: Database["public"]["Enums"]["listing_condition"] | null
          created_at: string
          currency: string
          description: string | null
          draft_nudge_sent_at: string | null
          escrow_enabled: boolean
          escrow_fee_paid_at: string | null
          escrow_fee_session_id: string | null
          favorite_count: number
          frozen_at: string | null
          frozen_by: string | null
          frozen_reason: string | null
          hero_photo_path: string | null
          id: string
          kind: Database["public"]["Enums"]["listing_kind"]
          knitted_by: string | null
          listing_fee_nok: number | null
          listing_fee_session_id: string | null
          location: string | null
          moderation_notes: string | null
          pattern_external_title: string | null
          pattern_slug: string | null
          photos: string[]
          pre_freeze_status:
            | Database["public"]["Enums"]["listing_status"]
            | null
          price_nok: number
          promoted_at: string | null
          promoted_until: string | null
          promotion_tier: string | null
          published_at: string | null
          report_count: number
          reviewed_at: string | null
          reviewed_by: string | null
          search_vector: unknown
          seller_id: string
          shipping_info: string | null
          shipping_option: string | null
          shipping_price_nok: number
          size_age_months_max: number | null
          size_age_months_min: number | null
          size_label: string
          sold_at: string | null
          status: Database["public"]["Enums"]["listing_status"]
          store_id: string | null
          title: string
          updated_at: string
          yarn_ids: string[]
        }
        Insert: {
          buyer_id?: string | null
          can_meet?: boolean
          category: Database["public"]["Enums"]["listing_category"]
          colorway?: string | null
          condition?: Database["public"]["Enums"]["listing_condition"] | null
          created_at?: string
          currency?: string
          description?: string | null
          draft_nudge_sent_at?: string | null
          escrow_enabled?: boolean
          escrow_fee_paid_at?: string | null
          escrow_fee_session_id?: string | null
          favorite_count?: number
          frozen_at?: string | null
          frozen_by?: string | null
          frozen_reason?: string | null
          hero_photo_path?: string | null
          id?: string
          kind: Database["public"]["Enums"]["listing_kind"]
          knitted_by?: string | null
          listing_fee_nok?: number | null
          listing_fee_session_id?: string | null
          location?: string | null
          moderation_notes?: string | null
          pattern_external_title?: string | null
          pattern_slug?: string | null
          photos?: string[]
          pre_freeze_status?:
            | Database["public"]["Enums"]["listing_status"]
            | null
          price_nok: number
          promoted_at?: string | null
          promoted_until?: string | null
          promotion_tier?: string | null
          published_at?: string | null
          report_count?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          search_vector?: unknown
          seller_id: string
          shipping_info?: string | null
          shipping_option?: string | null
          shipping_price_nok?: number
          size_age_months_max?: number | null
          size_age_months_min?: number | null
          size_label: string
          sold_at?: string | null
          status?: Database["public"]["Enums"]["listing_status"]
          store_id?: string | null
          title: string
          updated_at?: string
          yarn_ids?: string[]
        }
        Update: {
          buyer_id?: string | null
          can_meet?: boolean
          category?: Database["public"]["Enums"]["listing_category"]
          colorway?: string | null
          condition?: Database["public"]["Enums"]["listing_condition"] | null
          created_at?: string
          currency?: string
          description?: string | null
          draft_nudge_sent_at?: string | null
          escrow_enabled?: boolean
          escrow_fee_paid_at?: string | null
          escrow_fee_session_id?: string | null
          favorite_count?: number
          frozen_at?: string | null
          frozen_by?: string | null
          frozen_reason?: string | null
          hero_photo_path?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["listing_kind"]
          knitted_by?: string | null
          listing_fee_nok?: number | null
          listing_fee_session_id?: string | null
          location?: string | null
          moderation_notes?: string | null
          pattern_external_title?: string | null
          pattern_slug?: string | null
          photos?: string[]
          pre_freeze_status?:
            | Database["public"]["Enums"]["listing_status"]
            | null
          price_nok?: number
          promoted_at?: string | null
          promoted_until?: string | null
          promotion_tier?: string | null
          published_at?: string | null
          report_count?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          search_vector?: unknown
          seller_id?: string
          shipping_info?: string | null
          shipping_option?: string | null
          shipping_price_nok?: number
          size_age_months_max?: number | null
          size_age_months_min?: number | null
          size_label?: string
          sold_at?: string | null
          status?: Database["public"]["Enums"]["listing_status"]
          store_id?: string | null
          title?: string
          updated_at?: string
          yarn_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "listings_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_conversations: {
        Row: {
          buyer_id: string
          commission_request_id: string | null
          created_at: string
          id: string
          listing_id: string | null
          seller_id: string
          updated_at: string
        }
        Insert: {
          buyer_id: string
          commission_request_id?: string | null
          created_at?: string
          id?: string
          listing_id?: string | null
          seller_id: string
          updated_at?: string
        }
        Update: {
          buyer_id?: string
          commission_request_id?: string | null
          created_at?: string
          id?: string
          listing_id?: string | null
          seller_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_conversations_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_conversations_commission_request_id_fkey"
            columns: ["commission_request_id"]
            isOneToOne: false
            referencedRelation: "commission_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_conversations_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_conversations_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_messages: {
        Row: {
          body: string
          conversation_id: string
          created_at: string
          id: string
          read_at: string | null
          sender_id: string
        }
        Insert: {
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id: string
        }
        Update: {
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "marketplace_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_audit_log: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          details: Json | null
          id: string
          queue_item_id: string | null
          target_id: string
          target_type: string
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          details?: Json | null
          id?: string
          queue_item_id?: string | null
          target_id: string
          target_type: string
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          details?: Json | null
          id?: string
          queue_item_id?: string | null
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "moderation_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_audit_log_queue_item_id_fkey"
            columns: ["queue_item_id"]
            isOneToOne: false
            referencedRelation: "moderation_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          is_moderator: boolean
          read_at: string | null
          sender_id: string
          thread_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          is_moderator?: boolean
          read_at?: string | null
          sender_id: string
          thread_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_moderator?: boolean
          read_at?: string | null
          sender_id?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "moderation_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "moderation_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_queue: {
        Row: {
          assigned_to: string | null
          created_at: string
          decision_at: string | null
          decision_by: string | null
          id: string
          internal_notes: string | null
          item_id: string
          item_type: string
          rejection_reason: string | null
          shadow_confirmed_at: string | null
          shadow_confirmed_by: string | null
          shadow_decision_overridden: boolean | null
          shadow_review: boolean
          spot_check: boolean
          spot_check_agreed: boolean | null
          spot_check_at: string | null
          spot_check_by: string | null
          status: string
          submitter_id: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          decision_at?: string | null
          decision_by?: string | null
          id?: string
          internal_notes?: string | null
          item_id: string
          item_type: string
          rejection_reason?: string | null
          shadow_confirmed_at?: string | null
          shadow_confirmed_by?: string | null
          shadow_decision_overridden?: boolean | null
          shadow_review?: boolean
          spot_check?: boolean
          spot_check_agreed?: boolean | null
          spot_check_at?: string | null
          spot_check_by?: string | null
          status?: string
          submitter_id: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          decision_at?: string | null
          decision_by?: string | null
          id?: string
          internal_notes?: string | null
          item_id?: string
          item_type?: string
          rejection_reason?: string | null
          shadow_confirmed_at?: string | null
          shadow_confirmed_by?: string | null
          shadow_decision_overridden?: boolean | null
          shadow_review?: boolean
          spot_check?: boolean
          spot_check_agreed?: boolean | null
          spot_check_at?: string | null
          spot_check_by?: string | null
          status?: string
          submitter_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "moderation_queue_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_queue_decision_by_fkey"
            columns: ["decision_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_queue_shadow_confirmed_by_fkey"
            columns: ["shadow_confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_queue_spot_check_by_fkey"
            columns: ["spot_check_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_queue_submitter_id_fkey"
            columns: ["submitter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_threads: {
        Row: {
          closed_at: string | null
          created_at: string
          id: string
          recipient_id: string
          report_id: string | null
          status: string
          target_id: string
          target_type: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          id?: string
          recipient_id: string
          report_id?: string | null
          status?: string
          target_id: string
          target_type: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          id?: string
          recipient_id?: string
          report_id?: string | null
          status?: string
          target_id?: string
          target_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "moderation_threads_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_threads_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      moderator_payouts: {
        Row: {
          amount_nok: number
          created_at: string
          id: string
          moderator_id: string
          notes: string | null
          paid_at: string | null
          period_end: string
          period_start: string
          review_count: number
          status: string
        }
        Insert: {
          amount_nok: number
          created_at?: string
          id?: string
          moderator_id: string
          notes?: string | null
          paid_at?: string | null
          period_end: string
          period_start: string
          review_count: number
          status?: string
        }
        Update: {
          amount_nok?: number
          created_at?: string
          id?: string
          moderator_id?: string
          notes?: string | null
          paid_at?: string | null
          period_end?: string
          period_start?: string
          review_count?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "moderator_payouts_moderator_id_fkey"
            columns: ["moderator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      moderator_stats: {
        Row: {
          created_at: string
          current_month_earned_nok: number
          current_month_reviews: number
          last_review_at: string | null
          rate_nok_per_review: number
          shadow_overrides: number
          spot_check_disagreements: number
          stats_reset_at: string
          total_approvals: number
          total_earned_nok: number
          total_escalations: number
          total_rejections: number
          total_reviews: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_month_earned_nok?: number
          current_month_reviews?: number
          last_review_at?: string | null
          rate_nok_per_review?: number
          shadow_overrides?: number
          spot_check_disagreements?: number
          stats_reset_at?: string
          total_approvals?: number
          total_earned_nok?: number
          total_escalations?: number
          total_rejections?: number
          total_reviews?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_month_earned_nok?: number
          current_month_reviews?: number
          last_review_at?: string | null
          rate_nok_per_review?: number
          shadow_overrides?: number
          spot_check_disagreements?: number
          stats_reset_at?: string
          total_approvals?: number
          total_earned_nok?: number
          total_escalations?: number
          total_rejections?: number
          total_reviews?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "moderator_stats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      needles: {
        Row: {
          brand: string | null
          created_at: string
          id: string
          length_cm: number | null
          material: string | null
          needle_type: string
          notes: string | null
          size_mm: number
          updated_at: string
          user_id: string
        }
        Insert: {
          brand?: string | null
          created_at?: string
          id?: string
          length_cm?: number | null
          material?: string | null
          needle_type: string
          notes?: string | null
          size_mm: number
          updated_at?: string
          user_id: string
        }
        Update: {
          brand?: string | null
          created_at?: string
          id?: string
          length_cm?: number | null
          material?: string | null
          needle_type?: string
          notes?: string | null
          size_mm?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          created_at: string
          email_commission_completed: boolean
          email_commission_delivered: boolean
          email_item_approved: boolean
          email_item_rejected: boolean
          email_new_message: boolean
          email_new_offer: boolean
          email_offer_accepted: boolean
          email_offer_declined: boolean
          email_payment_received: boolean
          email_project_update: boolean
          email_request_expired: boolean
          email_review_received: boolean
          email_yarn_received: boolean
          email_yarn_shipped: boolean
          push_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email_commission_completed?: boolean
          email_commission_delivered?: boolean
          email_item_approved?: boolean
          email_item_rejected?: boolean
          email_new_message?: boolean
          email_new_offer?: boolean
          email_offer_accepted?: boolean
          email_offer_declined?: boolean
          email_payment_received?: boolean
          email_project_update?: boolean
          email_request_expired?: boolean
          email_review_received?: boolean
          email_yarn_received?: boolean
          email_yarn_shipped?: boolean
          push_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email_commission_completed?: boolean
          email_commission_delivered?: boolean
          email_item_approved?: boolean
          email_item_rejected?: boolean
          email_new_message?: boolean
          email_new_offer?: boolean
          email_offer_accepted?: boolean
          email_offer_declined?: boolean
          email_payment_received?: boolean
          email_project_update?: boolean
          email_request_expired?: boolean
          email_review_received?: boolean
          email_yarn_received?: boolean
          email_yarn_shipped?: boolean
          push_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          actor_id: string | null
          body: string | null
          created_at: string
          id: string
          read_at: string | null
          reference_id: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          url: string | null
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          reference_id?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          url?: string | null
          user_id: string
        }
        Update: {
          actor_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          reference_id?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          auto_release_at: string | null
          buyer_id: string
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          delivered_at: string | null
          dispute_reason: string | null
          dispute_resolution: string | null
          dispute_resolved_at: string | null
          disputed_at: string | null
          id: string
          item_price_nok: number
          listing_id: string
          platform_fee_nok: number
          refund_description: string | null
          refund_notes: string | null
          refund_outcome: string | null
          refund_reason: string | null
          refund_requested_at: string | null
          refund_resolved_at: string | null
          reserved_at: string
          seller_id: string
          ship_deadline_at: string | null
          shipped_at: string | null
          shipping_address: string | null
          shipping_city: string | null
          shipping_name: string | null
          shipping_nok: number
          shipping_postal_code: string | null
          status: Database["public"]["Enums"]["order_status"]
          store_id: string | null
          stripe_dispute_id: string | null
          stripe_payment_intent_id: string | null
          tb_fee_nok: number
          tracking_code: string | null
        }
        Insert: {
          auto_release_at?: string | null
          buyer_id: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          delivered_at?: string | null
          dispute_reason?: string | null
          dispute_resolution?: string | null
          dispute_resolved_at?: string | null
          disputed_at?: string | null
          id?: string
          item_price_nok: number
          listing_id: string
          platform_fee_nok?: number
          refund_description?: string | null
          refund_notes?: string | null
          refund_outcome?: string | null
          refund_reason?: string | null
          refund_requested_at?: string | null
          refund_resolved_at?: string | null
          reserved_at?: string
          seller_id: string
          ship_deadline_at?: string | null
          shipped_at?: string | null
          shipping_address?: string | null
          shipping_city?: string | null
          shipping_name?: string | null
          shipping_nok?: number
          shipping_postal_code?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          store_id?: string | null
          stripe_dispute_id?: string | null
          stripe_payment_intent_id?: string | null
          tb_fee_nok?: number
          tracking_code?: string | null
        }
        Update: {
          auto_release_at?: string | null
          buyer_id?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          delivered_at?: string | null
          dispute_reason?: string | null
          dispute_resolution?: string | null
          dispute_resolved_at?: string | null
          disputed_at?: string | null
          id?: string
          item_price_nok?: number
          listing_id?: string
          platform_fee_nok?: number
          refund_description?: string | null
          refund_notes?: string | null
          refund_outcome?: string | null
          refund_reason?: string | null
          refund_requested_at?: string | null
          refund_resolved_at?: string | null
          reserved_at?: string
          seller_id?: string
          ship_deadline_at?: string | null
          shipped_at?: string | null
          shipping_address?: string | null
          shipping_city?: string | null
          shipping_name?: string | null
          shipping_nok?: number
          shipping_postal_code?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          store_id?: string | null
          stripe_dispute_id?: string | null
          stripe_payment_intent_id?: string | null
          tb_fee_nok?: number
          tracking_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          age_confirmed_at: string | null
          avatar_path: string | null
          bio: string | null
          birthday: string | null
          created_at: string
          deleted_at: string | null
          display_name: string | null
          first_name: string | null
          id: string
          instagram_handle: string | null
          last_name: string | null
          locale: string
          location: string | null
          marketing_consent_at: string | null
          profile_visible: boolean
          role: Database["public"]["Enums"]["user_role"] | null
          seller_tags: string[]
          tos_accepted_at: string | null
          total_completed_transactions: number
          total_rejections: number
          trust_score: number
          trust_tier: string
          updated_at: string
          welcomed_at: string | null
        }
        Insert: {
          age_confirmed_at?: string | null
          avatar_path?: string | null
          bio?: string | null
          birthday?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          first_name?: string | null
          id: string
          instagram_handle?: string | null
          last_name?: string | null
          locale?: string
          location?: string | null
          marketing_consent_at?: string | null
          profile_visible?: boolean
          role?: Database["public"]["Enums"]["user_role"] | null
          seller_tags?: string[]
          tos_accepted_at?: string | null
          total_completed_transactions?: number
          total_rejections?: number
          trust_score?: number
          trust_tier?: string
          updated_at?: string
          welcomed_at?: string | null
        }
        Update: {
          age_confirmed_at?: string | null
          avatar_path?: string | null
          bio?: string | null
          birthday?: string | null
          created_at?: string
          deleted_at?: string | null
          display_name?: string | null
          first_name?: string | null
          id?: string
          instagram_handle?: string | null
          last_name?: string | null
          locale?: string
          location?: string | null
          marketing_consent_at?: string | null
          profile_visible?: boolean
          role?: Database["public"]["Enums"]["user_role"] | null
          seller_tags?: string[]
          tos_accepted_at?: string | null
          total_completed_transactions?: number
          total_rejections?: number
          trust_score?: number
          trust_tier?: string
          updated_at?: string
          welcomed_at?: string | null
        }
        Relationships: []
      }
      project_logs: {
        Row: {
          body: string
          created_at: string
          id: string
          log_date: string
          photos: string[]
          project_id: string
          rows_at: number | null
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          log_date?: string
          photos?: string[]
          project_id: string
          rows_at?: number | null
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          log_date?: string
          photos?: string[]
          project_id?: string
          rows_at?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_yarns: {
        Row: {
          created_at: string
          deducted_at: string | null
          grams_used: number
          id: string
          project_id: string
          yarn_id: string
        }
        Insert: {
          created_at?: string
          deducted_at?: string | null
          grams_used: number
          id?: string
          project_id: string
          yarn_id: string
        }
        Update: {
          created_at?: string
          deducted_at?: string | null
          grams_used?: number
          id?: string
          project_id?: string
          yarn_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_yarns_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_yarns_yarn_id_fkey"
            columns: ["yarn_id"]
            isOneToOne: false
            referencedRelation: "yarns"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          commission_offer_id: string | null
          created_at: string
          current_rows: number | null
          external_pattern_id: string | null
          finished_at: string | null
          hero_photo_path: string | null
          id: string
          needles: string | null
          pattern_external: string | null
          pattern_slug: string | null
          public_slug: string | null
          recipient: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["project_status"]
          summary: string | null
          target_rows: number | null
          target_size: string | null
          title: string
          updated_at: string
          user_id: string
          yarn: string | null
        }
        Insert: {
          commission_offer_id?: string | null
          created_at?: string
          current_rows?: number | null
          external_pattern_id?: string | null
          finished_at?: string | null
          hero_photo_path?: string | null
          id?: string
          needles?: string | null
          pattern_external?: string | null
          pattern_slug?: string | null
          public_slug?: string | null
          recipient?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          summary?: string | null
          target_rows?: number | null
          target_size?: string | null
          title: string
          updated_at?: string
          user_id: string
          yarn?: string | null
        }
        Update: {
          commission_offer_id?: string | null
          created_at?: string
          current_rows?: number | null
          external_pattern_id?: string | null
          finished_at?: string | null
          hero_photo_path?: string | null
          id?: string
          needles?: string | null
          pattern_external?: string | null
          pattern_slug?: string | null
          public_slug?: string | null
          recipient?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          summary?: string | null
          target_rows?: number | null
          target_size?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          yarn?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_commission_offer_id_fkey"
            columns: ["commission_offer_id"]
            isOneToOne: false
            referencedRelation: "commission_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_external_pattern_id_fkey"
            columns: ["external_pattern_id"]
            isOneToOne: false
            referencedRelation: "external_patterns"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          amount_nok: number
          created_at: string
          currency: string
          fulfilled_at: string | null
          id: string
          pattern_slug: string
          pdf_path: string | null
          status: Database["public"]["Enums"]["purchase_status"]
          stripe_session_id: string
          user_id: string
        }
        Insert: {
          amount_nok: number
          created_at?: string
          currency?: string
          fulfilled_at?: string | null
          id?: string
          pattern_slug: string
          pdf_path?: string | null
          status?: Database["public"]["Enums"]["purchase_status"]
          stripe_session_id: string
          user_id: string
        }
        Update: {
          amount_nok?: number
          created_at?: string
          currency?: string
          fulfilled_at?: string | null
          id?: string
          pattern_slug?: string
          pdf_path?: string | null
          status?: Database["public"]["Enums"]["purchase_status"]
          stripe_session_id?: string
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          anonymous: boolean
          created_at: string
          description: string | null
          id: string
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_id: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          target_id: string
          target_type: string
        }
        Insert: {
          anonymous?: boolean
          created_at?: string
          description?: string | null
          id?: string
          reason: Database["public"]["Enums"]["report_reason"]
          reporter_id: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          target_id: string
          target_type: string
        }
        Update: {
          anonymous?: boolean
          created_at?: string
          description?: string | null
          id?: string
          reason?: Database["public"]["Enums"]["report_reason"]
          reporter_id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_follows: {
        Row: {
          created_at: string
          follower_id: string
          seller_id: string
        }
        Insert: {
          created_at?: string
          follower_id: string
          seller_id: string
        }
        Update: {
          created_at?: string
          follower_id?: string
          seller_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_follows_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_profiles: {
        Row: {
          address: string | null
          birthdate: string | null
          city: string | null
          created_at: string
          id: string
          kontonummer: string | null
          legal_name: string | null
          postal_code: string | null
          seller_terms_accepted_at: string | null
          seller_verified_at: string | null
          stripe_account_id: string | null
          stripe_connect_requirements: Json | null
          stripe_connect_status: string
          stripe_onboarded: boolean
          updated_at: string
        }
        Insert: {
          address?: string | null
          birthdate?: string | null
          city?: string | null
          created_at?: string
          id: string
          kontonummer?: string | null
          legal_name?: string | null
          postal_code?: string | null
          seller_terms_accepted_at?: string | null
          seller_verified_at?: string | null
          stripe_account_id?: string | null
          stripe_connect_requirements?: Json | null
          stripe_connect_status?: string
          stripe_onboarded?: boolean
          updated_at?: string
        }
        Update: {
          address?: string | null
          birthdate?: string | null
          city?: string | null
          created_at?: string
          id?: string
          kontonummer?: string | null
          legal_name?: string | null
          postal_code?: string | null
          seller_terms_accepted_at?: string | null
          seller_verified_at?: string | null
          stripe_account_id?: string | null
          stripe_connect_requirements?: Json | null
          stripe_connect_status?: string
          stripe_onboarded?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_reviews: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          listing_id: string | null
          rating: number
          reviewer_id: string
          seller_id: string
          store_id: string | null
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          listing_id?: string | null
          rating: number
          reviewer_id: string
          seller_id: string
          store_id?: string | null
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          listing_id?: string | null
          rating?: number
          reviewer_id?: string
          seller_id?: string
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "seller_reviews_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_reviews_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_reviews_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["store_member_role"]
          store_id: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by: string
          role?: Database["public"]["Enums"]["store_member_role"]
          store_id: string
          token: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["store_member_role"]
          store_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_invitations_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_invitations_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_members: {
        Row: {
          id: string
          invited_by: string | null
          joined_at: string
          public_title: string | null
          role: Database["public"]["Enums"]["store_member_role"]
          store_id: string
          user_id: string
          visible_on_storefront: boolean | null
        }
        Insert: {
          id?: string
          invited_by?: string | null
          joined_at?: string
          public_title?: string | null
          role?: Database["public"]["Enums"]["store_member_role"]
          store_id: string
          user_id: string
          visible_on_storefront?: boolean | null
        }
        Update: {
          id?: string
          invited_by?: string | null
          joined_at?: string
          public_title?: string | null
          role?: Database["public"]["Enums"]["store_member_role"]
          store_id?: string
          user_id?: string
          visible_on_storefront?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "store_members_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_members_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          accent_color: string | null
          approved_at: string | null
          banner_path: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          description: string | null
          etsy_url: string | null
          id: string
          instagram_url: string | null
          legal_address: string | null
          legal_business_type: string | null
          legal_founded_date: string | null
          legal_industry_code: string | null
          legal_name: string
          legal_status: string | null
          location_city: string | null
          logo_path: string | null
          name: string
          opening_hours: Json | null
          orgnr: string
          pinterest_url: string | null
          promo_year_one_free: boolean | null
          reviewed_at: string | null
          reviewed_by: string | null
          slug: string
          status: Database["public"]["Enums"]["store_status"]
          stripe_account_id: string | null
          stripe_customer_id: string | null
          stripe_onboarded: boolean | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          tagline: string | null
          tier: Database["public"]["Enums"]["store_tier"]
          tiktok_url: string | null
          vat_registered: boolean
          verified: boolean | null
          website_url: string | null
        }
        Insert: {
          accent_color?: string | null
          approved_at?: string | null
          banner_path?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          description?: string | null
          etsy_url?: string | null
          id?: string
          instagram_url?: string | null
          legal_address?: string | null
          legal_business_type?: string | null
          legal_founded_date?: string | null
          legal_industry_code?: string | null
          legal_name: string
          legal_status?: string | null
          location_city?: string | null
          logo_path?: string | null
          name: string
          opening_hours?: Json | null
          orgnr: string
          pinterest_url?: string | null
          promo_year_one_free?: boolean | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          slug: string
          status?: Database["public"]["Enums"]["store_status"]
          stripe_account_id?: string | null
          stripe_customer_id?: string | null
          stripe_onboarded?: boolean | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          tagline?: string | null
          tier?: Database["public"]["Enums"]["store_tier"]
          tiktok_url?: string | null
          vat_registered?: boolean
          verified?: boolean | null
          website_url?: string | null
        }
        Update: {
          accent_color?: string | null
          approved_at?: string | null
          banner_path?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          description?: string | null
          etsy_url?: string | null
          id?: string
          instagram_url?: string | null
          legal_address?: string | null
          legal_business_type?: string | null
          legal_founded_date?: string | null
          legal_industry_code?: string | null
          legal_name?: string
          legal_status?: string | null
          location_city?: string | null
          logo_path?: string | null
          name?: string
          opening_hours?: Json | null
          orgnr?: string
          pinterest_url?: string | null
          promo_year_one_free?: boolean | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["store_status"]
          stripe_account_id?: string | null
          stripe_customer_id?: string | null
          stripe_onboarded?: boolean | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          tagline?: string | null
          tier?: Database["public"]["Enums"]["store_tier"]
          tiktok_url?: string | null
          vat_registered?: boolean
          verified?: boolean | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stores_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stores_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          event_id: string
          processed_at: string | null
          received_at: string
          type: string
        }
        Insert: {
          event_id: string
          processed_at?: string | null
          received_at?: string
          type: string
        }
        Update: {
          event_id?: string
          processed_at?: string | null
          received_at?: string
          type?: string
        }
        Relationships: []
      }
      support_requests: {
        Row: {
          body: string
          category: string
          created_at: string
          email: string | null
          handled_note: string | null
          id: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          subject: string | null
          user_id: string | null
        }
        Insert: {
          body: string
          category?: string
          created_at?: string
          email?: string | null
          handled_note?: string | null
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject?: string | null
          user_id?: string | null
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          email?: string | null
          handled_note?: string | null
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_requests_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_reviews: {
        Row: {
          comment: string | null
          commission_request_id: string
          created_at: string
          id: string
          rating: number
          reviewee_id: string
          reviewer_id: string
          reviewer_role: string
          visible: boolean
        }
        Insert: {
          comment?: string | null
          commission_request_id: string
          created_at?: string
          id?: string
          rating: number
          reviewee_id: string
          reviewer_id: string
          reviewer_role: string
          visible?: boolean
        }
        Update: {
          comment?: string | null
          commission_request_id?: string
          created_at?: string
          id?: string
          rating?: number
          reviewee_id?: string
          reviewer_id?: string
          reviewer_role?: string
          visible?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "transaction_reviews_commission_request_id_fkey"
            columns: ["commission_request_id"]
            isOneToOne: false
            referencedRelation: "commission_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_reviews_reviewee_id_fkey"
            columns: ["reviewee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_achievements: {
        Row: {
          achievement_key: string
          granted_at: string
          id: string
          user_id: string
        }
        Insert: {
          achievement_key: string
          granted_at?: string
          id?: string
          user_id: string
        }
        Update: {
          achievement_key?: string
          granted_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_achievements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_action_counts: {
        Row: {
          action: string
          count: number
          day: string
          user_id: string
        }
        Insert: {
          action: string
          count?: number
          day: string
          user_id: string
        }
        Update: {
          action?: string
          count?: number
          day?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_action_counts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      yarns: {
        Row: {
          acquired_at: string | null
          brand: string
          color: string | null
          created_at: string
          fiber: string | null
          id: string
          name: string
          notes: string | null
          photo_path: string | null
          total_grams: number | null
          total_meters: number | null
          updated_at: string
          user_id: string
          weight: string | null
        }
        Insert: {
          acquired_at?: string | null
          brand: string
          color?: string | null
          created_at?: string
          fiber?: string | null
          id?: string
          name: string
          notes?: string | null
          photo_path?: string | null
          total_grams?: number | null
          total_meters?: number | null
          updated_at?: string
          user_id: string
          weight?: string | null
        }
        Update: {
          acquired_at?: string | null
          brand?: string
          color?: string | null
          created_at?: string
          fiber?: string | null
          id?: string
          name?: string
          notes?: string | null
          photo_path?: string | null
          total_grams?: number | null
          total_meters?: number | null
          updated_at?: string
          user_id?: string
          weight?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      user_preferences: {
        Row: {
          age_band: Json | null
          clicked_categories: Json | null
          clicked_sizes: Json | null
          favorited_categories: Json | null
          followed_sellers: Json | null
          price_band: Json | null
          refreshed_at: string | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      has_store_min_role: {
        Args: {
          p_min_role: Database["public"]["Enums"]["store_member_role"]
          p_store_id: string
        }
        Returns: boolean
      }
      increment_moderator_stats: {
        Args: { p_amount?: number; p_field: string; p_user_id: string }
        Returns: undefined
      }
      increment_profile_rejections: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      increment_shadow_overrides: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      is_accepted_knitter: { Args: { req_id: string }; Returns: boolean }
      is_admin: { Args: { uid: string }; Returns: boolean }
      is_admin_or_moderator: { Args: { uid: string }; Returns: boolean }
      is_store_member: { Args: { p_store_id: string }; Returns: boolean }
      promotion_audience_breakdown: {
        Args: { p_listing_id: string }
        Returns: Json
      }
      refresh_user_preferences: { Args: never; Returns: undefined }
      reset_promotion_daily_windows: { Args: never; Returns: number }
      upsert_moderator_review: {
        Args: { p_decision: string; p_rate: number; p_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      commission_offer_status: "pending" | "accepted" | "declined" | "withdrawn"
      commission_request_status:
        | "pending_review"
        | "open"
        | "awaiting_payment"
        | "awaiting_yarn"
        | "awarded"
        | "completed"
        | "delivered"
        | "cancelled"
        | "expired"
        | "rejected"
        | "disputed"
        | "frozen"
      listing_category:
        | "genser"
        | "cardigan"
        | "lue"
        | "votter"
        | "sokker"
        | "teppe"
        | "kjole"
        | "bukser"
        | "annet"
      listing_condition: "som_ny" | "lite_brukt" | "brukt" | "slitt"
      listing_kind: "pre_loved" | "ready_made"
      listing_status:
        | "draft"
        | "pending_review"
        | "active"
        | "reserved"
        | "shipped"
        | "sold"
        | "removed"
        | "rejected"
        | "disputed"
        | "frozen"
      order_status:
        | "reserved"
        | "shipped"
        | "delivered"
        | "cancelled"
        | "disputed"
      notification_type:
        | "new_offer"
        | "offer_accepted"
        | "offer_declined"
        | "payment_received"
        | "project_update"
        | "new_message"
        | "yarn_shipped"
        | "yarn_received"
        | "commission_completed"
        | "commission_delivered"
        | "request_expired"
        | "item_approved"
        | "item_rejected"
        | "item_reported"
        | "moderation_assigned"
        | "role_changed"
        | "review_received"
        | "listing_purchased"
        | "listing_shipped"
        | "listing_delivered"
        | "dispute_opened"
        | "dispute_resolved"
        | "moderation_message"
        | "moderation_new_item"
        | "moderation_shadow_pending"
        | "achievement_unlocked"
        | "seller_new_listing"
        | "payout_failed"
        | "payment_failed"
        | "seller_activated"
      project_status: "planning" | "active" | "finished" | "frogged"
      purchase_status: "pending" | "completed" | "refunded"
      report_reason:
        | "scam"
        | "inappropriate"
        | "wrong_category"
        | "spam"
        | "other"
      store_member_role: "owner" | "admin" | "manager" | "contributor"
      store_status:
        | "draft"
        | "pending_review"
        | "active"
        | "suspended"
        | "archived"
      store_tier: "starter" | "pro" | "elite"
      user_role: "admin" | "moderator" | "ambassador"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      commission_offer_status: ["pending", "accepted", "declined", "withdrawn"],
      commission_request_status: [
        "pending_review",
        "open",
        "awaiting_payment",
        "awaiting_yarn",
        "awarded",
        "completed",
        "delivered",
        "cancelled",
        "expired",
        "rejected",
        "disputed",
        "frozen",
      ],
      listing_category: [
        "genser",
        "cardigan",
        "lue",
        "votter",
        "sokker",
        "teppe",
        "kjole",
        "bukser",
        "annet",
      ],
      listing_condition: ["som_ny", "lite_brukt", "brukt", "slitt"],
      listing_kind: ["pre_loved", "ready_made"],
      listing_status: [
        "draft",
        "pending_review",
        "active",
        "reserved",
        "shipped",
        "sold",
        "removed",
        "rejected",
        "disputed",
        "frozen",
      ],
      order_status: ["reserved", "shipped", "delivered", "cancelled", "disputed"],
      notification_type: [
        "new_offer",
        "offer_accepted",
        "offer_declined",
        "payment_received",
        "project_update",
        "new_message",
        "yarn_shipped",
        "yarn_received",
        "commission_completed",
        "commission_delivered",
        "request_expired",
        "item_approved",
        "item_rejected",
        "item_reported",
        "moderation_assigned",
        "role_changed",
        "review_received",
        "listing_purchased",
        "listing_shipped",
        "listing_delivered",
        "dispute_opened",
        "dispute_resolved",
        "moderation_message",
        "moderation_new_item",
        "moderation_shadow_pending",
        "achievement_unlocked",
        "seller_new_listing",
        "payout_failed",
        "payment_failed",
        "seller_activated",
      ],
      project_status: ["planning", "active", "finished", "frogged"],
      purchase_status: ["pending", "completed", "refunded"],
      report_reason: [
        "scam",
        "inappropriate",
        "wrong_category",
        "spam",
        "other",
      ],
      store_member_role: ["owner", "admin", "manager", "contributor"],
      store_status: [
        "draft",
        "pending_review",
        "active",
        "suspended",
        "archived",
      ],
      store_tier: ["starter", "pro", "elite"],
      user_role: ["admin", "moderator", "ambassador"],
    },
  },
} as const

