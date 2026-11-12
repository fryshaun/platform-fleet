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
 * How a component's service interval reads.
 *
 * Derived by `component_service_status` from the kind's interval, the part's
 * fitted window and the unit's usage logs; nothing stores it. `due_soon` is 80%
 * of an interval, so a workshop hears about a service before it is late.
 */
export type ServiceStatus = "ok" | "due_soon" | "overdue";

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
 * `available` can be booked, `in_workshop` is out of action but still in the
 * fleet, `retired` has left it, and `rented` is written **only** by
 * `refresh_asset_rented()` from the bookings beneath it.
 *
 * The list is complete on creation, like the products ladder, and the order here
 * is the database's order — `rented` was added after `retired`, so it sorts last.
 * `ASSET_STATUSES` in `lib/assets.ts` repeats this list, and the schema test
 * fails if the two drift.
 */
export type AssetStatus = "available" | "in_workshop" | "retired" | "rented";

/**
 * Where one reservation stands.
 *
 * `pending`, `confirmed` and `out` still hold the units on their lines;
 * `returned` and `cancelled` release them while keeping the record. The list is
 * complete on creation, like the other ladders, and `BLOCKING_BOOKING_STATUSES`
 * in `lib/bookings.ts` names the holding half so the UI and the SQL agree.
 */
export type BookingStatus =
  | "pending"
  | "confirmed"
  | "out"
  | "returned"
  | "cancelled";

/** Who took the booking: somebody at the desk, or a renter client. */
export type BookingChannel = "staff" | "api";

/**
 * How a catalogue extra is charged.
 *
 * `per_booking` charges once however long the hire runs; `per_day` multiplies by
 * the booking window. The pair is copied onto every `booking_line_addons` row
 * when the extra is taken, so a later change of offer cannot re-price a hire
 * somebody already agreed to.
 */
export type AddonPriceKind = "per_booking" | "per_day";

/**
 * Whether an extra is on offer.
 *
 * `archived` hides it from the picker without touching the bookings that took
 * it — a used extra cannot be deleted, so archiving is the verb the catalogue
 * page offers.
 */
export type AddonStatus = "active" | "archived";

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
          require_mfa: boolean;
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
          require_mfa?: boolean;
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
          require_mfa?: boolean;
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
          /** What the unit was before a booking made it rented. Trigger-written. */
          status_before_rent: AssetStatus | null;
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
          status_before_rent?: AssetStatus | null;
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
          status_before_rent?: AssetStatus | null;
          status_changed_at?: string;
          notes?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      /**
       * What kinds of part this workspace recognises (migration 18): Fork, Rear
       * shock, Wheelset. Flat and company-scoped, like `product_categories`.
       */
      component_kinds: {
        Row: {
          id: string;
          company_id: string;
          name: string;
          handle: string;
          position: number;
          /** Days between services. NULL or 0 means not measured in days. */
          interval_days: number | null;
          interval_km: number | null;
          interval_hours: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          name: string;
          handle: string;
          position?: number;
          interval_days?: number | null;
          interval_km?: number | null;
          interval_hours?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          name?: string;
          handle?: string;
          position?: number;
          interval_days?: number | null;
          interval_km?: number | null;
          interval_hours?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      /**
       * The parts themselves. `asset_id` null is a part in the bin; `removed_on`
       * null is a part fitted now.
       */
      asset_components: {
        Row: {
          id: string;
          company_id: string;
          kind_id: string | null;
          asset_id: string | null;
          name: string;
          serial: string | null;
          fitted_on: string;
          removed_on: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          kind_id?: string | null;
          asset_id?: string | null;
          name: string;
          serial?: string | null;
          fitted_on?: string;
          removed_on?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          kind_id?: string | null;
          asset_id?: string | null;
          name?: string;
          serial?: string | null;
          fitted_on?: string;
          removed_on?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      /**
       * What a unit has actually done, one reading at a time (migration 21).
       *
       * Readings are **incremental**: `hours` and `distance_km` are what happened
       * since the previous reading, not a cumulative odometer.
       */
      asset_usage_logs: {
        Row: {
          id: string;
          company_id: string;
          asset_id: string;
          logged_on: string;
          hours: number;
          distance_km: number;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          asset_id: string;
          logged_on?: string;
          hours?: number;
          distance_km?: number;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          asset_id?: string;
          logged_on?: string;
          hours?: number;
          distance_km?: number;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      /**
       * A service that happened, against a component (migration 22). Its date is
       * what resets the interval on the kind.
       */
      component_service_events: {
        Row: {
          id: string;
          company_id: string;
          component_id: string;
          serviced_on: string;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          component_id: string;
          serviced_on?: string;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          component_id?: string;
          serviced_on?: string;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      customers: {
        Row: {
          id: string;
          company_id: string;
          profile_id: string | null;
          handle: string;
          full_name: string;
          email: string | null;
          phone: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          profile_id?: string | null;
          handle: string;
          full_name: string;
          email?: string | null;
          phone?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          profile_id?: string | null;
          handle?: string;
          full_name?: string;
          email?: string | null;
          phone?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      rider_preferences: {
        Row: {
          customer_id: string;
          company_id: string;
          height_cm: number | null;
          weight_kg: number | null;
          inseam_cm: number | null;
          riding_level: string | null;
          disciplines: string[];
          notes: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          customer_id: string;
          company_id: string;
          height_cm?: number | null;
          weight_kg?: number | null;
          inseam_cm?: number | null;
          riding_level?: string | null;
          disciplines?: string[];
          notes?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          customer_id?: string;
          company_id?: string;
          height_cm?: number | null;
          weight_kg?: number | null;
          inseam_cm?: number | null;
          riding_level?: string | null;
          disciplines?: string[];
          notes?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      bookings: {
        Row: {
          id: string;
          company_id: string;
          reference: string;
          customer_id: string;
          status: BookingStatus;
          channel: BookingChannel;
          starts_on: string;
          ends_on: string;
          currency: string;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          reference: string;
          customer_id: string;
          status?: BookingStatus;
          channel?: BookingChannel;
          starts_on: string;
          ends_on: string;
          currency?: string;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          reference?: string;
          customer_id?: string;
          status?: BookingStatus;
          channel?: BookingChannel;
          starts_on?: string;
          ends_on?: string;
          currency?: string;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      booking_line_items: {
        Row: {
          id: string;
          company_id: string;
          booking_id: string;
          product_id: string | null;
          asset_id: string | null;
          /** The part this line books, when it is not booking a whole unit. */
          component_id: string | null;
          rider_id: string | null;
          quantity: number;
          unit_price_cents: number;
          starts_on: string;
          ends_on: string;
          blocks_stock: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          booking_id: string;
          product_id?: string | null;
          asset_id?: string | null;
          component_id?: string | null;
          rider_id?: string | null;
          quantity?: number;
          unit_price_cents?: number;
          starts_on?: string;
          ends_on?: string;
          blocks_stock?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          booking_id?: string;
          product_id?: string | null;
          asset_id?: string | null;
          component_id?: string | null;
          rider_id?: string | null;
          quantity?: number;
          unit_price_cents?: number;
          starts_on?: string;
          ends_on?: string;
          blocks_stock?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      /**
       * The extras catalogue (migration 15). Belongs to the bookings section, not
       * to products: it is the desk's offer list.
       */
      addons: {
        Row: {
          id: string;
          company_id: string;
          name: string;
          handle: string;
          description: string | null;
          price_cents: number;
          price_kind: AddonPriceKind;
          max_quantity: number;
          /** When true, the bookings may not take more than `quantity_on_hand`. */
          track_stock: boolean;
          /** How many the shop owns. Read only when `track_stock` is true. */
          quantity_on_hand: number;
          status: AddonStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          name: string;
          handle: string;
          description?: string | null;
          price_cents?: number;
          price_kind?: AddonPriceKind;
          max_quantity?: number;
          track_stock?: boolean;
          quantity_on_hand?: number;
          status?: AddonStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          name?: string;
          handle?: string;
          description?: string | null;
          price_cents?: number;
          price_kind?: AddonPriceKind;
          max_quantity?: number;
          track_stock?: boolean;
          quantity_on_hand?: number;
          status?: AddonStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      /**
       * Which products an extra is offered with. **No rows means every product**,
       * which is what lets a workspace without the products section use the
       * catalogue at all.
       */
      addon_products: {
        Row: {
          company_id: string;
          addon_id: string;
          product_id: string;
          created_at: string;
        };
        Insert: {
          company_id: string;
          addon_id: string;
          product_id: string;
          created_at?: string;
        };
        Update: {
          company_id?: string;
          addon_id?: string;
          product_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      /**
       * The extras a booking took, anchored on the line rather than on the
       * booking — deliberately no `booking_id`.
       */
      booking_line_addons: {
        Row: {
          id: string;
          company_id: string;
          line_item_id: string;
          addon_id: string;
          quantity: number;
          unit_price_cents: number;
          price_kind: AddonPriceKind;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          line_item_id: string;
          addon_id: string;
          quantity?: number;
          unit_price_cents?: number;
          price_kind?: AddonPriceKind;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          line_item_id?: string;
          addon_id?: string;
          quantity?: number;
          unit_price_cents?: number;
          price_kind?: AddonPriceKind;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      /**
       * What is out, and when — read from `booking_line_items` (migration 13).
       *
       * The view is `security_invoker = true`, so RLS on the table underneath
       * applies to whoever reads it. `period` is a `daterange`; PostgREST renders
       * it as its canonical string form, e.g. `[2026-03-01,2026-03-05)`.
       */
      asset_availability: {
        Row: {
          company_id: string;
          asset_id: string | null;
          booking_id: string;
          line_item_id: string;
          starts_on: string;
          ends_on: string;
          period: string;
        };
        Relationships: [];
      };
      /**
       * The derived service state of every component (migration 22).
       *
       * `security_invoker = true`, so it is exactly as readable as the tables
       * underneath it. `counted_from` is the later of the fitting and the last
       * service, and the sums are the unit's usage readings inside that window.
       */
      component_service_status: {
        Row: {
          company_id: string;
          component_id: string;
          asset_id: string | null;
          name: string;
          interval_days: number;
          interval_km: number;
          interval_hours: number;
          counted_from: string;
          days_since: number;
          hours_since: number;
          km_since: number;
          status: ServiceStatus;
        };
        Relationships: [];
      };
    };
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
      has_password: {
        Args: { [_ in never]: never };
        Returns: boolean;
      };
      storage_company_id: {
        Args: { object_name: string };
        Returns: string | null;
      };
      /**
       * How many blocking lines overlap the window. Advisory: the exclusion
       * constraint on `booking_line_items` is what actually refuses a clash.
       */
      check_asset_availability: {
        Args: {
          target_company_id: string;
          target_asset_id: string;
          from_date: string;
          to_date: string;
        };
        Returns: number;
      };
      booking_blocks_stock: {
        Args: { target_status: BookingStatus };
        Returns: boolean;
      };
      /**
       * Replaces an extra's product scope in one transaction (migration 15). An
       * empty array clears it, which the schema reads as "every product" — the
       * reason the delete and the inserts must not be separable.
       */
      set_addon_products: {
        Args: { target_addon_id: string; product_ids?: string[] };
        Returns: number;
      };
      /**
       * How many of an extra other blocking lines already took over the window
       * (migration 17). Advisory: the trigger on `booking_line_addons` decides.
       */
      check_addon_availability: {
        Args: {
          target_company_id: string;
          target_addon_id: string;
          from_date: string;
          to_date: string;
          exclude_line_item_id?: string | null;
        };
        Returns: number;
      };
      /**
       * Marks a unit rented while a blocking booking line holds it today, and
       * restores the remembered status afterwards (migration 25). Trigger-only:
       * no client role may execute it.
       */
      refresh_asset_rented: {
        Args: { target_company_id: string; target_asset_id: string };
        Returns: undefined;
      };
    };
    Enums: {
      member_role: MemberRole;
      subscription_status: SubscriptionStatus;
      product_status: ProductStatus;
      product_kind: ProductKind;
      product_media_kind: ProductMediaKind;
      asset_status: AssetStatus;
      booking_status: BookingStatus;
      booking_channel: BookingChannel;
      addon_price_kind: AddonPriceKind;
      addon_status: AddonStatus;
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
export type Views<T extends keyof Database["public"]["Views"]> =
  Database["public"]["Views"][T]["Row"];
