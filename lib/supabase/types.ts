/**
 * Typed schema for the `public` schema.
 *
 * Hand-maintained to mirror `supabase/migrations`. When the migrations change,
 * update this file (or regenerate with `supabase gen types typescript`).
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type MemberRole = "owner" | "admin" | "manager" | "staff" | "member";

export type SubscriptionStatus =
  | "none"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid"
  | "paused";

export type ProductStatus = "draft" | "active" | "archived";

/**
 * How a product is stocked.
 *
 * `item` counts one number (`inventory_quantity`); `dated` books rows in
 * `product_dates`, one per window.
 */
export type ProductKind = "item" | "dated";

export type ProductMediaKind = "image" | "video";

/**
 * The state of one physical unit.
 *
 * `available` can be booked, `maintenance` is out of action but still in the
 * fleet, `retired` has left it. The list is complete on creation, like the
 * products ladder.
 */
export type AssetStatus = "available" | "maintenance" | "retired";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      companies: {
        Row: {
          id: string;
          name: string;
          slug: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          subscription_status: SubscriptionStatus;
          trial_ends_at: string | null;
          enabled_sections: string[];
          currency: string;
          logo_url: string | null;
          badge: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          subscription_status?: SubscriptionStatus;
          trial_ends_at?: string | null;
          enabled_sections?: string[];
          currency?: string;
          logo_url?: string | null;
          badge?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          subscription_status?: SubscriptionStatus;
          trial_ends_at?: string | null;
          enabled_sections?: string[];
          currency?: string;
          logo_url?: string | null;
          badge?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      company_members: {
        Row: {
          id: string;
          company_id: string;
          user_id: string;
          role: MemberRole;
          invited_at: string | null;
          accepted_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          user_id: string;
          role?: MemberRole;
          invited_at?: string | null;
          accepted_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          user_id?: string;
          role?: MemberRole;
          invited_at?: string | null;
          accepted_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      product_categories: {
        Row: {
          id: string;
          company_id: string;
          name: string;
          handle: string;
          description: string | null;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          name: string;
          handle: string;
          description?: string | null;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          name?: string;
          handle?: string;
          description?: string | null;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          company_id: string;
          parent_id: string | null;
          category_id: string | null;
          title: string;
          handle: string;
          description: string | null;
          status: ProductStatus;
          kind: ProductKind;
          sku: string | null;
          supplier: string | null;
          price_cents: number;
          currency: string;
          compare_at_price_cents: number | null;
          track_inventory: boolean;
          inventory_quantity: number | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          parent_id?: string | null;
          category_id?: string | null;
          title: string;
          handle: string;
          description?: string | null;
          status?: ProductStatus;
          kind?: ProductKind;
          sku?: string | null;
          supplier?: string | null;
          price_cents?: number;
          currency?: string;
          compare_at_price_cents?: number | null;
          track_inventory?: boolean;
          inventory_quantity?: number | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          parent_id?: string | null;
          category_id?: string | null;
          title?: string;
          handle?: string;
          description?: string | null;
          status?: ProductStatus;
          kind?: ProductKind;
          sku?: string | null;
          supplier?: string | null;
          price_cents?: number;
          currency?: string;
          compare_at_price_cents?: number | null;
          track_inventory?: boolean;
          inventory_quantity?: number | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      product_media: {
        Row: {
          id: string;
          company_id: string;
          product_id: string;
          kind: ProductMediaKind;
          storage_path: string | null;
          url: string | null;
          alt: string | null;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          product_id: string;
          kind?: ProductMediaKind;
          storage_path?: string | null;
          url?: string | null;
          alt?: string | null;
          position?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          product_id?: string;
          kind?: ProductMediaKind;
          storage_path?: string | null;
          url?: string | null;
          alt?: string | null;
          position?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      product_dates: {
        Row: {
          id: string;
          company_id: string;
          product_id: string;
          starts_on: string;
          ends_on: string;
          inventory_quantity: number;
          price_cents: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          product_id: string;
          starts_on: string;
          ends_on: string;
          inventory_quantity?: number;
          price_cents?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          product_id?: string;
          starts_on?: string;
          ends_on?: string;
          inventory_quantity?: number;
          price_cents?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      assets: {
        Row: {
          id: string;
          company_id: string;
          product_id: string | null;
          name: string;
          handle: string;
          serial: string | null;
          status: AssetStatus;
          status_changed_at: string;
          notes: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          product_id?: string | null;
          name: string;
          handle: string;
          serial?: string | null;
          status?: AssetStatus;
          status_changed_at?: string;
          notes?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          product_id?: string | null;
          name?: string;
          handle?: string;
          serial?: string | null;
          status?: AssetStatus;
          status_changed_at?: string;
          notes?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      is_company_member: {
        Args: { target_company_id: string };
        Returns: boolean;
      };
      has_company_role: {
        Args: { target_company_id: string; allowed_roles: MemberRole[] };
        Returns: boolean;
      };
      current_member_role: {
        Args: { target_company_id: string };
        Returns: MemberRole | null;
      };
      shares_company_with: {
        Args: { target_user_id: string };
        Returns: boolean;
      };
      accept_company_invitations: {
        Args: { [_ in never]: never };
        Returns: number;
      };
      my_pending_invitations: {
        Args: { [_ in never]: never };
        Returns: {
          membership_id: string;
          company_id: string;
          company_name: string;
          company_slug: string;
          role: MemberRole;
          invited_at: string | null;
        }[];
      };
      respond_to_company_invitation: {
        Args: { target_membership_id: string; accept: boolean };
        Returns: boolean;
      };
      has_company_section: {
        Args: { target_company_id: string; section: string };
        Returns: boolean;
      };
      storage_company_id: {
        Args: { object_name: string };
        Returns: string | null;
      };
    };
    Enums: {
      member_role: MemberRole;
      subscription_status: SubscriptionStatus;
      product_status: ProductStatus;
      product_kind: ProductKind;
      product_media_kind: ProductMediaKind;
      asset_status: AssetStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
