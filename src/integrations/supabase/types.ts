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
      audit_logs: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          business_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: unknown
          metadata: Json | null
          new_data: Json | null
          old_data: Json | null
          user_agent: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          business_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          new_data?: Json | null
          old_data?: Json | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          business_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          new_data?: Json | null
          old_data?: Json | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_invitations: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          auth_user_id: string | null
          business_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          last_sent_at: string
          revoked_at: string | null
          role: string
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          auth_user_id?: string | null
          business_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          last_sent_at?: string
          revoked_at?: string | null
          role: string
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          auth_user_id?: string | null
          business_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          last_sent_at?: string
          revoked_at?: string | null
          role?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_invitations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_members: {
        Row: {
          business_id: string
          created_at: string
          id: string
          invited_by: string | null
          joined_at: string | null
          role: string
          status: string
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string | null
          role: string
          status?: string
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string | null
          role?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_members_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          base_currency: string
          business_type: string
          country: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          base_currency?: string
          business_type?: string
          country?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          base_currency?: string
          business_type?: string
          country?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      chart_of_accounts: {
        Row: {
          account_subtype: Database["public"]["Enums"]["account_subtype"] | null
          account_type: Database["public"]["Enums"]["account_type"]
          business_id: string
          code: string
          created_at: string
          created_by: string | null
          currency: string
          current_balance: number
          description: string | null
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          opening_balance: number
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          account_subtype?:
            | Database["public"]["Enums"]["account_subtype"]
            | null
          account_type: Database["public"]["Enums"]["account_type"]
          business_id?: string
          code: string
          created_at?: string
          created_by?: string | null
          currency?: string
          current_balance?: number
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          opening_balance?: number
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          account_subtype?:
            | Database["public"]["Enums"]["account_subtype"]
            | null
          account_type?: Database["public"]["Enums"]["account_type"]
          business_id?: string
          code?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          current_balance?: number
          description?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          opening_balance?: number
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chart_of_accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chart_of_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_fk_4100a7108f7bf4c9"
            columns: ["business_id", "parent_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      company_settings: {
        Row: {
          business_id: string
          company_address: string | null
          company_city: string | null
          company_country: string | null
          company_email: string | null
          company_logo_url: string | null
          company_name: string
          company_phone: string | null
          company_postal_code: string | null
          company_state: string | null
          company_tax_id: string | null
          created_at: string
          currency_code: string | null
          currency_symbol: string | null
          default_invoice_notes: string | null
          default_invoice_terms: string | null
          default_payment_terms: string | null
          id: string
          invoice_prefix: string | null
          notify_on_invoice_issued: boolean | null
          notify_on_overdue: boolean | null
          notify_on_payment_received: boolean | null
          overdue_reminder_days: number[] | null
          payment_prefix: string | null
          receipt_prefix: string | null
          updated_at: string
        }
        Insert: {
          business_id?: string
          company_address?: string | null
          company_city?: string | null
          company_country?: string | null
          company_email?: string | null
          company_logo_url?: string | null
          company_name?: string
          company_phone?: string | null
          company_postal_code?: string | null
          company_state?: string | null
          company_tax_id?: string | null
          created_at?: string
          currency_code?: string | null
          currency_symbol?: string | null
          default_invoice_notes?: string | null
          default_invoice_terms?: string | null
          default_payment_terms?: string | null
          id?: string
          invoice_prefix?: string | null
          notify_on_invoice_issued?: boolean | null
          notify_on_overdue?: boolean | null
          notify_on_payment_received?: boolean | null
          overdue_reminder_days?: number[] | null
          payment_prefix?: string | null
          receipt_prefix?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          company_address?: string | null
          company_city?: string | null
          company_country?: string | null
          company_email?: string | null
          company_logo_url?: string | null
          company_name?: string
          company_phone?: string | null
          company_postal_code?: string | null
          company_state?: string | null
          company_tax_id?: string | null
          created_at?: string
          currency_code?: string | null
          currency_symbol?: string | null
          default_invoice_notes?: string | null
          default_invoice_terms?: string | null
          default_payment_terms?: string | null
          id?: string
          invoice_prefix?: string | null
          notify_on_invoice_issued?: boolean | null
          notify_on_overdue?: boolean | null
          notify_on_payment_received?: boolean | null
          overdue_reminder_days?: number[] | null
          payment_prefix?: string | null
          receipt_prefix?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_settings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_note_line_taxes: {
        Row: {
          business_id: string
          created_at: string
          credit_note_line_id: string
          id: string
          is_compound: boolean
          liability_account_id: string
          source_invoice_item_tax_id: string
          tax_amount: number
          tax_code: string
          tax_id: string
          tax_name: string
          tax_order: number
          tax_rate: number
          taxable_amount: number
        }
        Insert: {
          business_id?: string
          created_at?: string
          credit_note_line_id: string
          id?: string
          is_compound: boolean
          liability_account_id: string
          source_invoice_item_tax_id: string
          tax_amount: number
          tax_code: string
          tax_id: string
          tax_name: string
          tax_order: number
          tax_rate: number
          taxable_amount: number
        }
        Update: {
          business_id?: string
          created_at?: string
          credit_note_line_id?: string
          id?: string
          is_compound?: boolean
          liability_account_id?: string
          source_invoice_item_tax_id?: string
          tax_amount?: number
          tax_code?: string
          tax_id?: string
          tax_name?: string
          tax_order?: number
          tax_rate?: number
          taxable_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "credit_note_line_taxes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_note_line_taxes_credit_note_line_id_fkey"
            columns: ["credit_note_line_id"]
            isOneToOne: false
            referencedRelation: "credit_note_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_note_line_taxes_liability_account_id_fkey"
            columns: ["liability_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_note_line_taxes_source_invoice_item_tax_id_fkey"
            columns: ["source_invoice_item_tax_id"]
            isOneToOne: false
            referencedRelation: "invoice_item_taxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_note_line_taxes_tax_id_fkey"
            columns: ["tax_id"]
            isOneToOne: false
            referencedRelation: "taxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_fk_5bbc9493bb166028"
            columns: ["business_id", "tax_id"]
            isOneToOne: false
            referencedRelation: "taxes"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_64bee63239d4c2e2"
            columns: ["business_id", "source_invoice_item_tax_id"]
            isOneToOne: false
            referencedRelation: "invoice_item_taxes"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_877aead5759f5a81"
            columns: ["business_id", "credit_note_line_id"]
            isOneToOne: false
            referencedRelation: "credit_note_lines"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_a492e04b9433c70c"
            columns: ["business_id", "liability_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      credit_note_lines: {
        Row: {
          business_id: string
          created_at: string
          credit_note_id: string
          description: string
          id: string
          inventory_cost: number
          invoice_item_id: string
          is_inventory_item: boolean
          net_amount: number
          product_id: string | null
          quantity: number
          tax_amount: number
          total_amount: number
          unit_cost: number | null
        }
        Insert: {
          business_id?: string
          created_at?: string
          credit_note_id: string
          description: string
          id?: string
          inventory_cost?: number
          invoice_item_id: string
          is_inventory_item?: boolean
          net_amount: number
          product_id?: string | null
          quantity: number
          tax_amount: number
          total_amount: number
          unit_cost?: number | null
        }
        Update: {
          business_id?: string
          created_at?: string
          credit_note_id?: string
          description?: string
          id?: string
          inventory_cost?: number
          invoice_item_id?: string
          is_inventory_item?: boolean
          net_amount?: number
          product_id?: string | null
          quantity?: number
          tax_amount?: number
          total_amount?: number
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_note_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_note_lines_credit_note_id_fkey"
            columns: ["credit_note_id"]
            isOneToOne: false
            referencedRelation: "credit_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_note_lines_invoice_item_id_fkey"
            columns: ["invoice_item_id"]
            isOneToOne: false
            referencedRelation: "invoice_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_note_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_fk_44234ea76f37b372"
            columns: ["business_id", "credit_note_id"]
            isOneToOne: false
            referencedRelation: "credit_notes"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_7a66125d60b26301"
            columns: ["business_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_de7e95a3511cf0c2"
            columns: ["business_id", "invoice_item_id"]
            isOneToOne: false
            referencedRelation: "invoice_items"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      credit_notes: {
        Row: {
          business_id: string
          created_at: string
          created_by: string
          credit_note_date: string
          credit_note_number: string
          customer_credit_amount: number
          customer_id: string
          id: string
          idempotency_key: string
          invoice_id: string
          journal_entry_id: string | null
          reason: string
          receivable_applied: number
          reference_number: string
          request_fingerprint: string
          subtotal: number
          tax_amount: number
          total_amount: number
        }
        Insert: {
          business_id?: string
          created_at?: string
          created_by: string
          credit_note_date: string
          credit_note_number: string
          customer_credit_amount?: number
          customer_id: string
          id?: string
          idempotency_key: string
          invoice_id: string
          journal_entry_id?: string | null
          reason: string
          receivable_applied?: number
          reference_number: string
          request_fingerprint: string
          subtotal?: number
          tax_amount?: number
          total_amount?: number
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string
          credit_note_date?: string
          credit_note_number?: string
          customer_credit_amount?: number
          customer_id?: string
          id?: string
          idempotency_key?: string
          invoice_id?: string
          journal_entry_id?: string | null
          reason?: string
          receivable_applied?: number
          reference_number?: string
          request_fingerprint?: string
          subtotal?: number
          tax_amount?: number
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "credit_notes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: true
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_fk_03072f4569e3da27"
            columns: ["business_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_2df2c6e76a77456a"
            columns: ["business_id", "journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_7625da4ff08b4679"
            columns: ["business_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      customer_credit_applications: {
        Row: {
          amount: number
          applied_on: string
          applied_to_invoice_id: string
          business_id: string
          created_at: string
          created_by: string
          credit_note_id: string
          id: string
          idempotency_key: string
          journal_entry_id: string | null
          reference_number: string
          request_fingerprint: string
        }
        Insert: {
          amount: number
          applied_on: string
          applied_to_invoice_id: string
          business_id?: string
          created_at?: string
          created_by: string
          credit_note_id: string
          id?: string
          idempotency_key: string
          journal_entry_id?: string | null
          reference_number: string
          request_fingerprint: string
        }
        Update: {
          amount?: number
          applied_on?: string
          applied_to_invoice_id?: string
          business_id?: string
          created_at?: string
          created_by?: string
          credit_note_id?: string
          id?: string
          idempotency_key?: string
          journal_entry_id?: string | null
          reference_number?: string
          request_fingerprint?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_credit_applications_applied_to_invoice_id_fkey"
            columns: ["applied_to_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_credit_applications_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_credit_applications_credit_note_id_fkey"
            columns: ["credit_note_id"]
            isOneToOne: false
            referencedRelation: "credit_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_credit_applications_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: true
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_fk_6e44092421d0675d"
            columns: ["business_id", "journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_7baff11da3871791"
            columns: ["business_id", "credit_note_id"]
            isOneToOne: false
            referencedRelation: "credit_notes"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_ce3b8ca53dc00889"
            columns: ["business_id", "applied_to_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      customer_credit_refunds: {
        Row: {
          amount: number
          business_id: string
          created_at: string
          created_by: string
          credit_note_id: string
          id: string
          idempotency_key: string
          journal_entry_id: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          reference_number: string
          refunded_on: string
          request_fingerprint: string
        }
        Insert: {
          amount: number
          business_id?: string
          created_at?: string
          created_by: string
          credit_note_id: string
          id?: string
          idempotency_key: string
          journal_entry_id?: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          reference_number: string
          refunded_on: string
          request_fingerprint: string
        }
        Update: {
          amount?: number
          business_id?: string
          created_at?: string
          created_by?: string
          credit_note_id?: string
          id?: string
          idempotency_key?: string
          journal_entry_id?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          reference_number?: string
          refunded_on?: string
          request_fingerprint?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_credit_refunds_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_credit_refunds_credit_note_id_fkey"
            columns: ["credit_note_id"]
            isOneToOne: false
            referencedRelation: "credit_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_credit_refunds_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: true
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_fk_640c3bce9d9d9f23"
            columns: ["business_id", "credit_note_id"]
            isOneToOne: false
            referencedRelation: "credit_notes"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_90d3814b02543d84"
            columns: ["business_id", "journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      customers: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          business_id: string
          city: string | null
          code: string
          country: string | null
          created_at: string
          created_by: string | null
          credit_limit: number | null
          current_balance: number | null
          deleted_at: string | null
          email: string | null
          id: string
          is_active: boolean | null
          name: string
          notes: string | null
          phone: string | null
          postal_code: string | null
          state: string | null
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          business_id?: string
          city?: string | null
          code: string
          country?: string | null
          created_at?: string
          created_by?: string | null
          credit_limit?: number | null
          current_balance?: number | null
          deleted_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          notes?: string | null
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          business_id?: string
          city?: string | null
          code?: string
          country?: string | null
          created_at?: string
          created_by?: string | null
          credit_limit?: number | null
          current_balance?: number | null
          deleted_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          notes?: string | null
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      discounts: {
        Row: {
          business_id: string
          code: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean | null
          max_discount_amount: number | null
          min_order_amount: number | null
          name: string
          times_used: number | null
          type: Database["public"]["Enums"]["discount_type"]
          updated_at: string
          usage_limit: number | null
          valid_from: string | null
          valid_to: string | null
          value: number
        }
        Insert: {
          business_id?: string
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          max_discount_amount?: number | null
          min_order_amount?: number | null
          name: string
          times_used?: number | null
          type: Database["public"]["Enums"]["discount_type"]
          updated_at?: string
          usage_limit?: number | null
          valid_from?: string | null
          valid_to?: string | null
          value: number
        }
        Update: {
          business_id?: string
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          max_discount_amount?: number | null
          min_order_amount?: number | null
          name?: string
          times_used?: number | null
          type?: Database["public"]["Enums"]["discount_type"]
          updated_at?: string
          usage_limit?: number | null
          valid_from?: string | null
          valid_to?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "discounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_completeness_attestations: {
        Row: {
          attestation_sequence: number
          attested_at: string
          attested_by: string
          attested_through: string
          business_id: string
          evidence_digest: string
          id: string
          idempotency_key: string
          statement: string
        }
        Insert: {
          attestation_sequence?: never
          attested_at?: string
          attested_by: string
          attested_through: string
          business_id?: string
          evidence_digest: string
          id?: string
          idempotency_key: string
          statement: string
        }
        Update: {
          attestation_sequence?: never
          attested_at?: string
          attested_by?: string
          attested_through?: string
          business_id?: string
          evidence_digest?: string
          id?: string
          idempotency_key?: string
          statement?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_completeness_attestations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_count_adjustments: {
        Row: {
          adjustment_value: number
          business_id: string
          counted_on: string
          counted_quantity: number
          created_at: string
          id: string
          idempotency_key: string
          inventory_transaction_id: string
          journal_entry_id: string
          product_id: string
          quantity_delta: number
          reason: string
          recorded_by: string | null
          reference_number: string
          system_quantity: number
          unit_cost: number
        }
        Insert: {
          adjustment_value: number
          business_id?: string
          counted_on: string
          counted_quantity: number
          created_at?: string
          id?: string
          idempotency_key: string
          inventory_transaction_id: string
          journal_entry_id: string
          product_id: string
          quantity_delta: number
          reason: string
          recorded_by?: string | null
          reference_number: string
          system_quantity: number
          unit_cost: number
        }
        Update: {
          adjustment_value?: number
          business_id?: string
          counted_on?: string
          counted_quantity?: number
          created_at?: string
          id?: string
          idempotency_key?: string
          inventory_transaction_id?: string
          journal_entry_id?: string
          product_id?: string
          quantity_delta?: number
          reason?: string
          recorded_by?: string | null
          reference_number?: string
          system_quantity?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_count_adjustments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_adjustments_inventory_transaction_id_fkey"
            columns: ["inventory_transaction_id"]
            isOneToOne: true
            referencedRelation: "inventory_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_adjustments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: true
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_adjustments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_fk_10b3758d99ae7f6d"
            columns: ["business_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_70b72fa65b4c6338"
            columns: ["business_id", "inventory_transaction_id"]
            isOneToOne: false
            referencedRelation: "inventory_transactions"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_f16f0361a1f0d09f"
            columns: ["business_id", "journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      inventory_purchase_reversals: {
        Row: {
          business_id: string
          created_at: string
          id: string
          idempotency_key: string
          journal_entry_id: string
          original_purchase_transaction_id: string
          reason: string
          recorded_by: string | null
          reference_number: string
          refund_payment_method:
            | Database["public"]["Enums"]["payment_method"]
            | null
          refunded_amount: number
          reversal_inventory_transaction_id: string
          reversed_on: string
        }
        Insert: {
          business_id?: string
          created_at?: string
          id?: string
          idempotency_key: string
          journal_entry_id: string
          original_purchase_transaction_id: string
          reason: string
          recorded_by?: string | null
          reference_number: string
          refund_payment_method?:
            | Database["public"]["Enums"]["payment_method"]
            | null
          refunded_amount: number
          reversal_inventory_transaction_id: string
          reversed_on: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          journal_entry_id?: string
          original_purchase_transaction_id?: string
          reason?: string
          recorded_by?: string | null
          reference_number?: string
          refund_payment_method?:
            | Database["public"]["Enums"]["payment_method"]
            | null
          refunded_amount?: number
          reversal_inventory_transaction_id?: string
          reversed_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_purchase_reversals_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_purchase_reversals_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: true
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_purchase_reversals_original_purchase_transaction_fkey"
            columns: ["original_purchase_transaction_id"]
            isOneToOne: true
            referencedRelation: "inventory_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_purchase_reversals_reversal_inventory_transactio_fkey"
            columns: ["reversal_inventory_transaction_id"]
            isOneToOne: true
            referencedRelation: "inventory_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_fk_22a6c799e30c05a1"
            columns: ["business_id", "reversal_inventory_transaction_id"]
            isOneToOne: false
            referencedRelation: "inventory_transactions"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_639212af2b6eb86e"
            columns: ["business_id", "original_purchase_transaction_id"]
            isOneToOne: false
            referencedRelation: "inventory_transactions"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_9a6a76369da650f5"
            columns: ["business_id", "journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      inventory_transactions: {
        Row: {
          amount_paid: number
          business_id: string
          created_at: string
          id: string
          idempotency_key: string | null
          location_id: string
          destination_location_id: string | null
          new_quantity: number | null
          notes: string | null
          opening_unit_cost: number | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          performed_by: string | null
          previous_cost_verified: boolean
          previous_quantity: number | null
          previous_unit_cost: number | null
          product_id: string
          quantity: number
          reference_id: string | null
          reference_number: string | null
          reference_type: string | null
          supplier_name: string | null
          total_cost: number | null
          type: string
          unit_cost: number | null
        }
        Insert: {
          amount_paid?: number
          business_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string | null
          location_id: string
          destination_location_id?: string | null
          new_quantity?: number | null
          notes?: string | null
          opening_unit_cost?: number | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          performed_by?: string | null
          previous_cost_verified?: boolean
          previous_quantity?: number | null
          previous_unit_cost?: number | null
          product_id: string
          quantity: number
          reference_id?: string | null
          reference_number?: string | null
          reference_type?: string | null
          supplier_name?: string | null
          total_cost?: number | null
          type: string
          unit_cost?: number | null
        }
        Update: {
          amount_paid?: number
          business_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string | null
          location_id?: string
          destination_location_id?: string | null
          new_quantity?: number | null
          notes?: string | null
          opening_unit_cost?: number | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          performed_by?: string | null
          previous_cost_verified?: boolean
          previous_quantity?: number | null
          previous_unit_cost?: number | null
          product_id?: string
          quantity?: number
          reference_id?: string | null
          reference_number?: string | null
          reference_type?: string | null
          supplier_name?: string | null
          total_cost?: number | null
          type?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transactions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transactions_location_fk"
            columns: ["business_id", "location_id"]
            isOneToOne: false
            referencedRelation: "store_locations"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "inventory_transactions_destination_location_fk"
            columns: ["business_id", "destination_location_id"]
            isOneToOne: false
            referencedRelation: "store_locations"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_fb3e3e3589eb856d"
            columns: ["business_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      invoice_item_direct_costs: {
        Row: {
          amount: number
          business_id: string
          created_at: string
          id: string
          incurred_on: string
          invoice_item_id: string
          journal_entry_id: string
          notes: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          recorded_by: string | null
          source_reference: string
        }
        Insert: {
          amount: number
          business_id?: string
          created_at?: string
          id?: string
          incurred_on: string
          invoice_item_id: string
          journal_entry_id: string
          notes?: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          recorded_by?: string | null
          source_reference: string
        }
        Update: {
          amount?: number
          business_id?: string
          created_at?: string
          id?: string
          incurred_on?: string
          invoice_item_id?: string
          journal_entry_id?: string
          notes?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          recorded_by?: string | null
          source_reference?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_item_direct_costs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_item_direct_costs_invoice_item_id_fkey"
            columns: ["invoice_item_id"]
            isOneToOne: true
            referencedRelation: "invoice_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_item_direct_costs_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: true
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_fk_73a4d71cedc8bc64"
            columns: ["business_id", "journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_c77174d1376d7150"
            columns: ["business_id", "invoice_item_id"]
            isOneToOne: false
            referencedRelation: "invoice_items"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      invoice_item_taxes: {
        Row: {
          business_id: string
          created_at: string
          id: string
          invoice_id: string
          invoice_item_id: string
          is_compound: boolean
          liability_account_id: string
          tax_amount: number
          tax_code: string
          tax_id: string
          tax_name: string
          tax_order: number
          tax_rate: number
          taxable_amount: number
        }
        Insert: {
          business_id?: string
          created_at?: string
          id?: string
          invoice_id: string
          invoice_item_id: string
          is_compound?: boolean
          liability_account_id: string
          tax_amount: number
          tax_code: string
          tax_id: string
          tax_name: string
          tax_order: number
          tax_rate: number
          taxable_amount: number
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          invoice_id?: string
          invoice_item_id?: string
          is_compound?: boolean
          liability_account_id?: string
          tax_amount?: number
          tax_code?: string
          tax_id?: string
          tax_name?: string
          tax_order?: number
          tax_rate?: number
          taxable_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_item_taxes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_item_taxes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_item_taxes_invoice_item_id_fkey"
            columns: ["invoice_item_id"]
            isOneToOne: false
            referencedRelation: "invoice_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_item_taxes_liability_account_id_fkey"
            columns: ["liability_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_item_taxes_tax_id_fkey"
            columns: ["tax_id"]
            isOneToOne: false
            referencedRelation: "taxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_fk_4a18775dd41ec061"
            columns: ["business_id", "tax_id"]
            isOneToOne: false
            referencedRelation: "taxes"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_4c6333c9da10892a"
            columns: ["business_id", "invoice_item_id"]
            isOneToOne: false
            referencedRelation: "invoice_items"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_6c6f20317eaa5c1a"
            columns: ["business_id", "liability_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_c0f3f5519a9b4096"
            columns: ["business_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          business_id: string
          cost_notes: string | null
          cost_reference: string | null
          cost_source: string | null
          cost_verified_at: string | null
          cost_verified_by: string | null
          created_at: string
          description: string
          discount_type: Database["public"]["Enums"]["discount_type"] | null
          discount_value: number | null
          id: string
          invoice_id: string
          line_total: number
          product_id: string | null
          quantity: number
          sort_order: number | null
          tax_amount: number | null
          tax_rate: number | null
          unit_cost: number | null
          unit_price: number
        }
        Insert: {
          business_id?: string
          cost_notes?: string | null
          cost_reference?: string | null
          cost_source?: string | null
          cost_verified_at?: string | null
          cost_verified_by?: string | null
          created_at?: string
          description: string
          discount_type?: Database["public"]["Enums"]["discount_type"] | null
          discount_value?: number | null
          id?: string
          invoice_id: string
          line_total: number
          product_id?: string | null
          quantity: number
          sort_order?: number | null
          tax_amount?: number | null
          tax_rate?: number | null
          unit_cost?: number | null
          unit_price: number
        }
        Update: {
          business_id?: string
          cost_notes?: string | null
          cost_reference?: string | null
          cost_source?: string | null
          cost_verified_at?: string | null
          cost_verified_by?: string | null
          created_at?: string
          description?: string
          discount_type?: Database["public"]["Enums"]["discount_type"] | null
          discount_value?: number | null
          id?: string
          invoice_id?: string
          line_total?: number
          product_id?: string | null
          quantity?: number
          sort_order?: number | null
          tax_amount?: number | null
          tax_rate?: number | null
          unit_cost?: number | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_fk_006afc4da88f84e2"
            columns: ["business_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_f2716e2987fa2e8d"
            columns: ["business_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      invoice_taxes: {
        Row: {
          business_id: string
          created_at: string
          id: string
          invoice_id: string
          liability_account_id: string
          tax_amount: number
          tax_id: string
          tax_rate: number
          taxable_amount: number
        }
        Insert: {
          business_id?: string
          created_at?: string
          id?: string
          invoice_id: string
          liability_account_id: string
          tax_amount: number
          tax_id: string
          tax_rate: number
          taxable_amount: number
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          invoice_id?: string
          liability_account_id?: string
          tax_amount?: number
          tax_id?: string
          tax_rate?: number
          taxable_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_taxes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_taxes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_taxes_liability_account_id_fkey"
            columns: ["liability_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_taxes_tax_id_fkey"
            columns: ["tax_id"]
            isOneToOne: false
            referencedRelation: "taxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_fk_21d876fb60ff3bc8"
            columns: ["business_id", "liability_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_66d7fdbd22adb1c2"
            columns: ["business_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_c3530b05cf720f72"
            columns: ["business_id", "tax_id"]
            isOneToOne: false
            referencedRelation: "taxes"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_paid: number | null
          balance_due: number | null
          business_id: string
          checksum: string | null
          created_at: string
          created_by: string | null
          customer_id: string
          deleted_at: string | null
          discount_amount: number | null
          discount_id: string | null
          due_date: string | null
          id: string
          invoice_number: string
          is_locked: boolean | null
          issue_date: string | null
          issued_at: string | null
          issued_by: string | null
          notes: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number | null
          tax_amount: number | null
          terms: string | null
          total_amount: number | null
          updated_at: string
        }
        Insert: {
          amount_paid?: number | null
          balance_due?: number | null
          business_id?: string
          checksum?: string | null
          created_at?: string
          created_by?: string | null
          customer_id: string
          deleted_at?: string | null
          discount_amount?: number | null
          discount_id?: string | null
          due_date?: string | null
          id?: string
          invoice_number: string
          is_locked?: boolean | null
          issue_date?: string | null
          issued_at?: string | null
          issued_by?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number | null
          tax_amount?: number | null
          terms?: string | null
          total_amount?: number | null
          updated_at?: string
        }
        Update: {
          amount_paid?: number | null
          balance_due?: number | null
          business_id?: string
          checksum?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string
          deleted_at?: string | null
          discount_amount?: number | null
          discount_id?: string | null
          due_date?: string | null
          id?: string
          invoice_number?: string
          is_locked?: boolean | null
          issue_date?: string | null
          issued_at?: string | null
          issued_by?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number | null
          tax_amount?: number | null
          terms?: string | null
          total_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_discount_id_fkey"
            columns: ["discount_id"]
            isOneToOne: false
            referencedRelation: "discounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_fk_35e2c0960aa4bb94"
            columns: ["business_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_e821e2d3f92618fa"
            columns: ["business_id", "discount_id"]
            isOneToOne: false
            referencedRelation: "discounts"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          currency: string
          description: string
          entry_date: string
          entry_number: string
          id: string
          source_id: string
          source_type: string
        }
        Insert: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description: string
          entry_date: string
          entry_number: string
          id?: string
          source_id: string
          source_type: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string
          entry_date?: string
          entry_number?: string
          id?: string
          source_id?: string
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_lines: {
        Row: {
          account_id: string
          business_id: string
          created_at: string
          credit: number
          debit: number
          description: string
          id: string
          journal_entry_id: string
          line_number: number
        }
        Insert: {
          account_id: string
          business_id?: string
          created_at?: string
          credit?: number
          debit?: number
          description: string
          id?: string
          journal_entry_id: string
          line_number: number
        }
        Update: {
          account_id?: string
          business_id?: string
          created_at?: string
          credit?: number
          debit?: number
          description?: string
          id?: string
          journal_entry_id?: string
          line_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "journal_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_fk_6fc03077f4ccfdf7"
            columns: ["business_id", "journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_c8282a0d60b8d2a3"
            columns: ["business_id", "account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      notifications: {
        Row: {
          business_id: string | null
          created_at: string
          id: string
          is_read: boolean
          link: string | null
          message: string
          read_at: string | null
          title: string
          type: string | null
          user_id: string
        }
        Insert: {
          business_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message: string
          read_at?: string | null
          title: string
          type?: string | null
          user_id: string
        }
        Update: {
          business_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message?: string
          read_at?: string | null
          title?: string
          type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      operating_expense_payments: {
        Row: {
          amount: number
          business_id: string
          created_at: string
          id: string
          idempotency_key: string
          journal_entry_id: string
          operating_expense_id: string
          paid_on: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          recorded_by: string | null
          reference_number: string
        }
        Insert: {
          amount: number
          business_id?: string
          created_at?: string
          id?: string
          idempotency_key: string
          journal_entry_id: string
          operating_expense_id: string
          paid_on: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          recorded_by?: string | null
          reference_number: string
        }
        Update: {
          amount?: number
          business_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          journal_entry_id?: string
          operating_expense_id?: string
          paid_on?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          recorded_by?: string | null
          reference_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "operating_expense_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operating_expense_payments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: true
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operating_expense_payments_operating_expense_id_fkey"
            columns: ["operating_expense_id"]
            isOneToOne: false
            referencedRelation: "operating_expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_fk_41f8cf73577306b7"
            columns: ["business_id", "operating_expense_id"]
            isOneToOne: false
            referencedRelation: "operating_expenses"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_e24e29cb353d8408"
            columns: ["business_id", "journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      operating_expense_refunds: {
        Row: {
          amount: number
          business_id: string
          created_at: string
          id: string
          idempotency_key: string
          journal_entry_id: string
          operating_expense_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          recorded_by: string | null
          reference_number: string
          refunded_on: string
        }
        Insert: {
          amount: number
          business_id?: string
          created_at?: string
          id?: string
          idempotency_key: string
          journal_entry_id: string
          operating_expense_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          recorded_by?: string | null
          reference_number: string
          refunded_on: string
        }
        Update: {
          amount?: number
          business_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          journal_entry_id?: string
          operating_expense_id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          recorded_by?: string | null
          reference_number?: string
          refunded_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "operating_expense_refunds_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operating_expense_refunds_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: true
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operating_expense_refunds_operating_expense_id_fkey"
            columns: ["operating_expense_id"]
            isOneToOne: false
            referencedRelation: "operating_expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_fk_077726b6647ba501"
            columns: ["business_id", "operating_expense_id"]
            isOneToOne: false
            referencedRelation: "operating_expenses"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_4870aea2a75b8d6a"
            columns: ["business_id", "journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      operating_expense_reversals: {
        Row: {
          amount: number
          business_id: string
          created_at: string
          id: string
          idempotency_key: string
          journal_entry_id: string
          operating_expense_id: string
          reason: string
          recorded_by: string | null
          reference_number: string
        }
        Insert: {
          amount: number
          business_id?: string
          created_at?: string
          id?: string
          idempotency_key: string
          journal_entry_id: string
          operating_expense_id: string
          reason: string
          recorded_by?: string | null
          reference_number: string
        }
        Update: {
          amount?: number
          business_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          journal_entry_id?: string
          operating_expense_id?: string
          reason?: string
          recorded_by?: string | null
          reference_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "operating_expense_reversals_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operating_expense_reversals_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: true
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operating_expense_reversals_operating_expense_id_fkey"
            columns: ["operating_expense_id"]
            isOneToOne: true
            referencedRelation: "operating_expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_fk_83b9f3115c2cc51f"
            columns: ["business_id", "operating_expense_id"]
            isOneToOne: false
            referencedRelation: "operating_expenses"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_f44d0ef016e90ab1"
            columns: ["business_id", "journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      operating_expenses: {
        Row: {
          amount: number
          amount_paid: number
          business_id: string
          created_at: string
          description: string
          due_on: string | null
          expense_account_id: string
          expense_number: string
          id: string
          idempotency_key: string
          incurred_on: string
          initial_amount_paid: number
          initial_payment_method:
            | Database["public"]["Enums"]["payment_method"]
            | null
          initial_payment_reference: string | null
          notes: string | null
          recorded_by: string | null
          reference_number: string
          updated_at: string
          vendor_name: string
        }
        Insert: {
          amount: number
          amount_paid?: number
          business_id?: string
          created_at?: string
          description: string
          due_on?: string | null
          expense_account_id: string
          expense_number: string
          id?: string
          idempotency_key: string
          incurred_on: string
          initial_amount_paid?: number
          initial_payment_method?:
            | Database["public"]["Enums"]["payment_method"]
            | null
          initial_payment_reference?: string | null
          notes?: string | null
          recorded_by?: string | null
          reference_number: string
          updated_at?: string
          vendor_name: string
        }
        Update: {
          amount?: number
          amount_paid?: number
          business_id?: string
          created_at?: string
          description?: string
          due_on?: string | null
          expense_account_id?: string
          expense_number?: string
          id?: string
          idempotency_key?: string
          incurred_on?: string
          initial_amount_paid?: number
          initial_payment_method?:
            | Database["public"]["Enums"]["payment_method"]
            | null
          initial_payment_reference?: string | null
          notes?: string | null
          recorded_by?: string | null
          reference_number?: string
          updated_at?: string
          vendor_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "operating_expenses_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operating_expenses_expense_account_id_fkey"
            columns: ["expense_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_fk_1faf55cae1ce4968"
            columns: ["business_id", "expense_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      password_history: {
        Row: {
          created_at: string
          id: string
          password_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          password_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          password_hash?: string
          user_id?: string
        }
        Relationships: []
      }
      password_policy: {
        Row: {
          disallow_spaces: boolean
          history_count: number
          id: number
          max_requests_per_hour: number
          min_length: number
          otp_ttl_minutes: number
          require_lowercase: boolean
          require_mfa: boolean
          require_number: boolean
          require_special: boolean
          require_uppercase: boolean
          security_questions_enabled: boolean
          token_ttl_minutes: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          disallow_spaces?: boolean
          history_count?: number
          id?: number
          max_requests_per_hour?: number
          min_length?: number
          otp_ttl_minutes?: number
          require_lowercase?: boolean
          require_mfa?: boolean
          require_number?: boolean
          require_special?: boolean
          require_uppercase?: boolean
          security_questions_enabled?: boolean
          token_ttl_minutes?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          disallow_spaces?: boolean
          history_count?: number
          id?: number
          max_requests_per_hour?: number
          min_length?: number
          otp_ttl_minutes?: number
          require_lowercase?: boolean
          require_mfa?: boolean
          require_number?: boolean
          require_special?: boolean
          require_uppercase?: boolean
          security_questions_enabled?: boolean
          token_ttl_minutes?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      password_reset_attempts: {
        Row: {
          created_at: string
          email: string | null
          id: string
          ip_address: string | null
          reason: string | null
          result: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          ip_address?: string | null
          reason?: string | null
          result: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          ip_address?: string | null
          reason?: string | null
          result?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      password_reset_lockouts: {
        Row: {
          created_at: string
          email: string | null
          failure_count: number
          id: string
          ip_address: string | null
          last_failure_at: string
          locked_until: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          failure_count?: number
          id?: string
          ip_address?: string | null
          last_failure_at?: string
          locked_until?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          failure_count?: number
          id?: string
          ip_address?: string | null
          last_failure_at?: string
          locked_until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      password_reset_tokens: {
        Row: {
          channel: string
          created_at: string
          expires_at: string
          id: string
          ip_address: string | null
          mfa_attempts: number
          mfa_method: string | null
          mfa_required: boolean
          mfa_verified_at: string | null
          otp_attempts: number
          otp_hash: string | null
          token_hash: string
          used_at: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          channel?: string
          created_at?: string
          expires_at: string
          id?: string
          ip_address?: string | null
          mfa_attempts?: number
          mfa_method?: string | null
          mfa_required?: boolean
          mfa_verified_at?: string | null
          otp_attempts?: number
          otp_hash?: string | null
          token_hash: string
          used_at?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          expires_at?: string
          id?: string
          ip_address?: string | null
          mfa_attempts?: number
          mfa_method?: string | null
          mfa_required?: boolean
          mfa_verified_at?: string | null
          otp_attempts?: number
          otp_hash?: string | null
          token_hash?: string
          used_at?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      payment_clearing_settlements: {
        Row: {
          bank_reference: string
          business_id: string
          clearing_account_id: string
          created_at: string
          created_by: string
          fee_amount: number
          gross_amount: number
          id: string
          idempotency_key: string
          journal_entry_id: string
          net_amount: number | null
          notes: string | null
          provider_reference: string
          request_fingerprint: string
          settled_on: string
        }
        Insert: {
          bank_reference: string
          business_id?: string
          clearing_account_id: string
          created_at?: string
          created_by: string
          fee_amount?: number
          gross_amount: number
          id?: string
          idempotency_key: string
          journal_entry_id: string
          net_amount?: number | null
          notes?: string | null
          provider_reference: string
          request_fingerprint: string
          settled_on: string
        }
        Update: {
          bank_reference?: string
          business_id?: string
          clearing_account_id?: string
          created_at?: string
          created_by?: string
          fee_amount?: number
          gross_amount?: number
          id?: string
          idempotency_key?: string
          journal_entry_id?: string
          net_amount?: number | null
          notes?: string | null
          provider_reference?: string
          request_fingerprint?: string
          settled_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_clearing_settlements_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_clearing_settlements_clearing_account_id_fkey"
            columns: ["clearing_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_clearing_settlements_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: true
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_fk_0c42693cbec0dd7b"
            columns: ["business_id", "journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_d79a78fd83c211a2"
            columns: ["business_id", "clearing_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          business_id: string
          created_at: string
          customer_id: string
          deleted_at: string | null
          id: string
          idempotency_key: string | null
          invoice_id: string
          notes: string | null
          payment_date: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_number: string
          processed_by: string | null
          reference_number: string | null
        }
        Insert: {
          amount: number
          business_id?: string
          created_at?: string
          customer_id: string
          deleted_at?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_id: string
          notes?: string | null
          payment_date?: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_number: string
          processed_by?: string | null
          reference_number?: string | null
        }
        Update: {
          amount?: number
          business_id?: string
          created_at?: string
          customer_id?: string
          deleted_at?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_id?: string
          notes?: string | null
          payment_date?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_number?: string
          processed_by?: string | null
          reference_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_fk_18aa9034371d636b"
            columns: ["business_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_36d1eae955e63cf9"
            columns: ["business_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      permissions: {
        Row: {
          code: string
          description: string | null
          id: string
        }
        Insert: {
          code: string
          description?: string | null
          id?: string
        }
        Update: {
          code?: string
          description?: string | null
          id?: string
        }
        Relationships: []
      }
      petty_cash_expense_reversals: {
        Row: {
          amount: number
          business_id: string
          created_at: string
          id: string
          idempotency_key: string
          journal_entry_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          petty_cash_transaction_id: string
          reason: string
          recorded_by: string | null
          reference_number: string
          reversed_on: string
        }
        Insert: {
          amount: number
          business_id?: string
          created_at?: string
          id?: string
          idempotency_key: string
          journal_entry_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          petty_cash_transaction_id: string
          reason: string
          recorded_by?: string | null
          reference_number: string
          reversed_on: string
        }
        Update: {
          amount?: number
          business_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          journal_entry_id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          petty_cash_transaction_id?: string
          reason?: string
          recorded_by?: string | null
          reference_number?: string
          reversed_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_expense_reversals_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_expense_reversals_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: true
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_expense_reversals_petty_cash_transaction_id_fkey"
            columns: ["petty_cash_transaction_id"]
            isOneToOne: true
            referencedRelation: "petty_cash_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_fk_2c787901f99281a0"
            columns: ["business_id", "petty_cash_transaction_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_transactions"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_47db09f515ba7327"
            columns: ["business_id", "journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      petty_cash_transactions: {
        Row: {
          amount: number
          business_id: string
          category: string | null
          created_at: string
          date: string
          description: string
          id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          recorded_by: string | null
          reference_number: string | null
          type: string
          updated_at: string
        }
        Insert: {
          amount: number
          business_id?: string
          category?: string | null
          created_at?: string
          date?: string
          description: string
          id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          recorded_by?: string | null
          reference_number?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          amount?: number
          business_id?: string
          category?: string | null
          created_at?: string
          date?: string
          description?: string
          id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          recorded_by?: string | null
          reference_number?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_transactions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      product_price_history: {
        Row: {
          business_id: string
          change_reason: string | null
          changed_by: string | null
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          price: number
          product_id: string
        }
        Insert: {
          business_id?: string
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          price: number
          product_id: string
        }
        Update: {
          business_id?: string
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          price?: number
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_price_history_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_price_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_fk_0e0ef6efe3f14bdd"
            columns: ["business_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      products: {
        Row: {
          business_id: string
          category: string | null
          cost_price: number | null
          cost_price_verified: boolean
          created_at: string
          created_by: string | null
          current_price: number
          deleted_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          is_service: boolean | null
          min_stock_level: number | null
          name: string
          sku: string
          stock_quantity: number | null
          tax_category: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          business_id?: string
          category?: string | null
          cost_price?: number | null
          cost_price_verified?: boolean
          created_at?: string
          created_by?: string | null
          current_price: number
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_service?: boolean | null
          min_stock_level?: number | null
          name: string
          sku: string
          stock_quantity?: number | null
          tax_category?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          category?: string | null
          cost_price?: number | null
          cost_price_verified?: boolean
          created_at?: string
          created_by?: string | null
          current_price?: number
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_service?: boolean | null
          min_stock_level?: number | null
          name?: string
          sku?: string
          stock_quantity?: number | null
          tax_category?: string | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      product_location_settings: {
        Row: {
          business_id: string
          created_at: string
          id: string
          is_active: boolean
          lead_time_days: number
          location_id: string
          minimum_quantity: number
          product_id: string
          replenishment_method: string
          reorder_point: number
          safety_stock: number
          target_quantity: number | null
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          lead_time_days?: number
          location_id: string
          minimum_quantity?: number
          product_id: string
          replenishment_method?: string
          reorder_point?: number
          safety_stock?: number
          target_quantity?: number | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          lead_time_days?: number
          location_id?: string
          minimum_quantity?: number
          product_id?: string
          replenishment_method?: string
          reorder_point?: number
          safety_stock?: number
          target_quantity?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_location_settings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_location_settings_location_fk"
            columns: ["business_id", "location_id"]
            isOneToOne: false
            referencedRelation: "store_locations"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "product_location_settings_product_fk"
            columns: ["business_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      stock_balances: {
        Row: {
          available_quantity: number
          business_id: string
          id: string
          location_id: string
          on_hand: number
          opening_quantity: number
          opening_snapshot_at: string
          product_id: string
          quarantined: number
          reserved: number
          updated_at: string
        }
        Insert: {
          business_id: string
          id?: string
          location_id: string
          on_hand?: number
          opening_quantity?: number
          opening_snapshot_at?: string
          product_id: string
          quarantined?: number
          reserved?: number
          updated_at?: string
        }
        Update: {
          business_id?: string
          id?: string
          location_id?: string
          on_hand?: number
          opening_quantity?: number
          opening_snapshot_at?: string
          product_id?: string
          quarantined?: number
          reserved?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_balances_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_location_fk"
            columns: ["business_id", "location_id"]
            isOneToOne: false
            referencedRelation: "store_locations"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "stock_balances_product_fk"
            columns: ["business_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      store_locations: {
        Row: {
          address: string | null
          business_id: string
          code: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          is_default: boolean
          location_type: string
          name: string
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          business_id: string
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          location_type?: string
          name: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          business_id?: string
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          location_type?: string
          name?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_locations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfers: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          business_id: string
          canceled_at: string | null
          canceled_by: string | null
          cancellation_reason: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          destination_location_id: string
          dispatch_idempotency_key: string | null
          dispatched_at: string | null
          dispatched_by: string | null
          id: string
          idempotency_key: string
          line_snapshot: Json
          notes: string | null
          reference_number: string
          request_fingerprint: string
          source_location_id: string
          status: string
          transit_location_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          business_id: string
          canceled_at?: string | null
          canceled_by?: string | null
          cancellation_reason?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          destination_location_id: string
          dispatch_idempotency_key?: string | null
          dispatched_at?: string | null
          dispatched_by?: string | null
          id?: string
          idempotency_key: string
          line_snapshot: Json
          notes?: string | null
          reference_number: string
          request_fingerprint: string
          source_location_id: string
          status?: string
          transit_location_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          business_id?: string
          canceled_at?: string | null
          canceled_by?: string | null
          cancellation_reason?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          destination_location_id?: string
          dispatch_idempotency_key?: string | null
          dispatched_at?: string | null
          dispatched_by?: string | null
          id?: string
          idempotency_key?: string
          line_snapshot?: Json
          notes?: string | null
          reference_number?: string
          request_fingerprint?: string
          source_location_id?: string
          status?: string
          transit_location_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_source_location_fk"
            columns: ["business_id", "source_location_id"]
            isOneToOne: false
            referencedRelation: "store_locations"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "stock_transfers_destination_location_fk"
            columns: ["business_id", "destination_location_id"]
            isOneToOne: false
            referencedRelation: "store_locations"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "stock_transfers_transit_location_fk"
            columns: ["business_id", "transit_location_id"]
            isOneToOne: false
            referencedRelation: "store_locations"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      stock_transfer_lines: {
        Row: {
          business_id: string
          created_at: string
          dispatch_inventory_transaction_id: string | null
          dispatched_quantity: number
          id: string
          product_id: string
          received_quantity: number
          requested_quantity: number
          transfer_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          dispatch_inventory_transaction_id?: string | null
          dispatched_quantity?: number
          id?: string
          product_id: string
          received_quantity?: number
          requested_quantity: number
          transfer_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          dispatch_inventory_transaction_id?: string | null
          dispatched_quantity?: number
          id?: string
          product_id?: string
          received_quantity?: number
          requested_quantity?: number
          transfer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfer_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_lines_transfer_fk"
            columns: ["business_id", "transfer_id"]
            isOneToOne: false
            referencedRelation: "stock_transfers"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "stock_transfer_lines_product_fk"
            columns: ["business_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "stock_transfer_lines_dispatch_transaction_fk"
            columns: ["business_id", "dispatch_inventory_transaction_id"]
            isOneToOne: false
            referencedRelation: "inventory_transactions"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      stock_transfer_receipts: {
        Row: {
          business_id: string
          id: string
          idempotency_key: string
          line_snapshot: Json
          notes: string | null
          received_at: string
          received_by: string
          receipt_reference: string
          request_fingerprint: string
          transfer_id: string
        }
        Insert: {
          business_id: string
          id?: string
          idempotency_key: string
          line_snapshot: Json
          notes?: string | null
          received_at?: string
          received_by: string
          receipt_reference: string
          request_fingerprint: string
          transfer_id: string
        }
        Update: {
          business_id?: string
          id?: string
          idempotency_key?: string
          line_snapshot?: Json
          notes?: string | null
          received_at?: string
          received_by?: string
          receipt_reference?: string
          request_fingerprint?: string
          transfer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfer_receipts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_receipts_transfer_fk"
            columns: ["business_id", "transfer_id"]
            isOneToOne: false
            referencedRelation: "stock_transfers"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      stock_transfer_receipt_lines: {
        Row: {
          business_id: string
          created_at: string
          id: string
          inventory_transaction_id: string
          product_id: string
          quantity: number
          receipt_id: string
          transfer_line_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          inventory_transaction_id: string
          product_id: string
          quantity: number
          receipt_id: string
          transfer_line_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          inventory_transaction_id?: string
          product_id?: string
          quantity?: number
          receipt_id?: string
          transfer_line_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfer_receipt_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_receipt_lines_receipt_fk"
            columns: ["business_id", "receipt_id"]
            isOneToOne: false
            referencedRelation: "stock_transfer_receipts"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "stock_transfer_receipt_lines_transfer_line_fk"
            columns: ["business_id", "transfer_line_id"]
            isOneToOne: false
            referencedRelation: "stock_transfer_lines"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "stock_transfer_receipt_lines_product_fk"
            columns: ["business_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "stock_transfer_receipt_lines_inventory_transaction_fk"
            columns: ["business_id", "inventory_transaction_id"]
            isOneToOne: false
            referencedRelation: "inventory_transactions"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      store_stock_counts: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          business_id: string
          canceled_at: string | null
          canceled_by: string | null
          cancellation_reason: string | null
          created_at: string
          created_by: string
          id: string
          idempotency_key: string
          journal_entry_id: string | null
          line_snapshot: Json
          location_id: string
          notes: string | null
          posted_at: string | null
          posted_by: string | null
          posting_idempotency_key: string | null
          reference_number: string
          request_fingerprint: string
          snapshot_at: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          business_id: string
          canceled_at?: string | null
          canceled_by?: string | null
          cancellation_reason?: string | null
          created_at?: string
          created_by: string
          id?: string
          idempotency_key: string
          journal_entry_id?: string | null
          line_snapshot?: Json
          location_id: string
          notes?: string | null
          posted_at?: string | null
          posted_by?: string | null
          posting_idempotency_key?: string | null
          reference_number: string
          request_fingerprint: string
          snapshot_at?: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          business_id?: string
          canceled_at?: string | null
          canceled_by?: string | null
          cancellation_reason?: string | null
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key?: string
          journal_entry_id?: string | null
          line_snapshot?: Json
          location_id?: string
          notes?: string | null
          posted_at?: string | null
          posted_by?: string | null
          posting_idempotency_key?: string | null
          reference_number?: string
          request_fingerprint?: string
          snapshot_at?: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_stock_counts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_stock_counts_location_fk"
            columns: ["business_id", "location_id"]
            isOneToOne: false
            referencedRelation: "store_locations"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "store_stock_counts_journal_fk"
            columns: ["business_id", "journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      store_stock_count_lines: {
        Row: {
          adjustment_value: number
          business_id: string
          counted_at: string | null
          counted_by: string | null
          counted_quantity: number | null
          count_id: string
          created_at: string
          id: string
          inventory_transaction_id: string | null
          product_id: string
          reason: string | null
          system_quantity_snapshot: number
          unit_cost_snapshot: number | null
          variance_quantity: number
        }
        Insert: {
          adjustment_value?: number
          business_id: string
          counted_at?: string | null
          counted_by?: string | null
          counted_quantity?: number | null
          count_id: string
          created_at?: string
          id?: string
          inventory_transaction_id?: string | null
          product_id: string
          reason?: string | null
          system_quantity_snapshot: number
          unit_cost_snapshot?: number | null
          variance_quantity?: number
        }
        Update: {
          adjustment_value?: number
          business_id?: string
          counted_at?: string | null
          counted_by?: string | null
          counted_quantity?: number | null
          count_id?: string
          created_at?: string
          id?: string
          inventory_transaction_id?: string | null
          product_id?: string
          reason?: string | null
          system_quantity_snapshot?: number
          unit_cost_snapshot?: number | null
          variance_quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "store_stock_count_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_stock_count_lines_count_fk"
            columns: ["business_id", "count_id"]
            isOneToOne: false
            referencedRelation: "store_stock_counts"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "store_stock_count_lines_product_fk"
            columns: ["business_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "store_stock_count_lines_transaction_fk"
            columns: ["business_id", "inventory_transaction_id"]
            isOneToOne: false
            referencedRelation: "inventory_transactions"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          department: string | null
          email: string
          full_name: string | null
          id: string
          is_active: boolean | null
          job_title: string | null
          phone: string | null
          signature_data: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          department?: string | null
          email: string
          full_name?: string | null
          id: string
          is_active?: boolean | null
          job_title?: string | null
          phone?: string | null
          signature_data?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          department?: string | null
          email?: string
          full_name?: string | null
          id?: string
          is_active?: boolean | null
          job_title?: string | null
          phone?: string | null
          signature_data?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      receipts: {
        Row: {
          amount: number
          business_id: string
          checksum: string | null
          created_at: string
          customer_id: string
          deleted_at: string | null
          id: string
          idempotency_key: string | null
          invoice_id: string | null
          is_locked: boolean | null
          issue_date: string
          issued_by: string
          issuer_name: string
          notes: string | null
          payment_id: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          receipt_number: string
          signature_data: string | null
          signature_hash: string | null
          status: Database["public"]["Enums"]["receipt_status"]
        }
        Insert: {
          amount: number
          business_id?: string
          checksum?: string | null
          created_at?: string
          customer_id: string
          deleted_at?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_id?: string | null
          is_locked?: boolean | null
          issue_date?: string
          issued_by: string
          issuer_name: string
          notes?: string | null
          payment_id?: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          receipt_number: string
          signature_data?: string | null
          signature_hash?: string | null
          status?: Database["public"]["Enums"]["receipt_status"]
        }
        Update: {
          amount?: number
          business_id?: string
          checksum?: string | null
          created_at?: string
          customer_id?: string
          deleted_at?: string | null
          id?: string
          idempotency_key?: string | null
          invoice_id?: string | null
          is_locked?: boolean | null
          issue_date?: string
          issued_by?: string
          issuer_name?: string
          notes?: string | null
          payment_id?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          receipt_number?: string
          signature_data?: string | null
          signature_hash?: string | null
          status?: Database["public"]["Enums"]["receipt_status"]
        }
        Relationships: [
          {
            foreignKeyName: "receipts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_fk_07373b09283f4e2e"
            columns: ["business_id", "payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_5adcdf19765d60cb"
            columns: ["business_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "tenant_fk_fee8a2babff84fd0"
            columns: ["business_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          permission_id: string
          role: string
        }
        Insert: {
          permission_id: string
          role: string
        }
        Update: {
          permission_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
        ]
      }
      sequences: {
        Row: {
          business_id: string
          current_value: number | null
          name: string
          padding: number | null
          prefix: string
          updated_at: string
        }
        Insert: {
          business_id?: string
          current_value?: number | null
          name: string
          padding?: number | null
          prefix: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          current_value?: number | null
          name?: string
          padding?: number | null
          prefix?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sequences_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      taxes: {
        Row: {
          applies_to_category: string | null
          business_id: string
          code: string
          created_at: string
          created_by: string | null
          effective_from: string | null
          effective_to: string | null
          id: string
          is_active: boolean | null
          is_compound: boolean | null
          liability_account_id: string | null
          name: string
          rate: number
          type: Database["public"]["Enums"]["tax_type"]
          updated_at: string
        }
        Insert: {
          applies_to_category?: string | null
          business_id?: string
          code: string
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          is_active?: boolean | null
          is_compound?: boolean | null
          liability_account_id?: string | null
          name: string
          rate: number
          type: Database["public"]["Enums"]["tax_type"]
          updated_at?: string
        }
        Update: {
          applies_to_category?: string | null
          business_id?: string
          code?: string
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          is_active?: boolean | null
          is_compound?: boolean | null
          liability_account_id?: string | null
          name?: string
          rate?: number
          type?: Database["public"]["Enums"]["tax_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "taxes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "taxes_liability_account_id_fkey"
            columns: ["liability_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_fk_21b57f19a14fd529"
            columns: ["business_id", "liability_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      user_mfa: {
        Row: {
          created_at: string
          enabled: boolean
          method: string
          phone: string | null
          totp_confirmed: boolean
          totp_secret: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          method?: string
          phone?: string | null
          totp_confirmed?: boolean
          totp_secret?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          method?: string
          phone?: string | null
          totp_confirmed?: boolean
          totp_secret?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          granted_at: string
          granted_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
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
      create_stock_transfer: {
        Args: {
          p_destination_location_id: string
          p_idempotency_key: string
          p_lines: Json
          p_notes: string | null
          p_reference_number: string
          p_source_location_id: string
        }
        Returns: string
      }
      approve_stock_transfer: {
        Args: { p_transfer_id: string }
        Returns: string
      }
      cancel_stock_transfer: {
        Args: { p_reason: string; p_transfer_id: string }
        Returns: string
      }
      dispatch_stock_transfer: {
        Args: { p_idempotency_key: string; p_transfer_id: string }
        Returns: string
      }
      receive_stock_transfer: {
        Args: {
          p_idempotency_key: string
          p_lines: Json
          p_notes?: string | null
          p_receipt_reference: string
          p_transfer_id: string
        }
        Returns: string
      }
      create_store_stock_count: {
        Args: {
          p_idempotency_key: string
          p_location_id: string
          p_notes: string | null
          p_product_ids?: string[] | null
          p_reference_number: string
        }
        Returns: string
      }
      record_store_stock_count_line: {
        Args: {
          p_count_id: string
          p_counted_quantity: number
          p_product_id: string
          p_reason?: string | null
        }
        Returns: string
      }
      submit_store_stock_count: {
        Args: { p_count_id: string }
        Returns: string
      }
      approve_store_stock_count: {
        Args: { p_count_id: string }
        Returns: string
      }
      cancel_store_stock_count: {
        Args: { p_count_id: string; p_reason: string }
        Returns: string
      }
      post_store_stock_count: {
        Args: { p_count_id: string; p_idempotency_key: string }
        Returns: string
      }
      accept_business_invitation: {
        Args: { p_invitation_id: string }
        Returns: string
      }

      get_business_members: {
        Args: { p_business_id: string }
        Returns: {
          created_at: string
          email: string
          full_name: string | null
          joined_at: string | null
          member_id: string
          role: string
          status: string
          user_id: string
        }[]
      }

      revoke_business_invitation: {
        Args: { p_invitation_id: string }
        Returns: boolean
      }

      apply_customer_credit: {
        Args: {
          p_amount: number
          p_applied_on: string
          p_credit_note_id: string
          p_idempotency_key: string
          p_invoice_id: string
          p_reference_number: string
        }
        Returns: string
      }
      assign_user_role: {
        Args: {
          granted_by_user: string
          role_name: Database["public"]["Enums"]["app_role"]
          target_user: string
        }
        Returns: undefined
      }
      attest_financial_completeness: {
        Args: {
          p_attested_through: string
          p_idempotency_key: string
          p_statement: string
        }
        Returns: string
      }
      claim_initial_admin: { Args: never; Returns: boolean }
      clear_reset_lockout: {
        Args: { _email: string; _ip: string }
        Returns: undefined
      }
      count_recent_reset_requests: {
        Args: { _email: string; _ip: string; _minutes?: number }
        Returns: number
      }
      create_business: {
        Args: {
          p_base_currency?: string
          p_business_type?: string
          p_country?: string
          p_name: string
          p_timezone?: string
        }
        Returns: string
      }
      current_business_id: { Args: never; Returns: string }
      create_invoice_draft: {
        Args: {
          p_customer_id: string
          p_discount_amount: number
          p_due_date: string
          p_issue_date: string
          p_items: Json
          p_notes: string
          p_prices_include_tax: boolean
          p_subtotal: number
          p_tax_amount: number
          p_terms: string
          p_total_amount: number
        }
        Returns: string
      }
      create_receipt_with_payment: {
        Args: {
          p_amount: number
          p_checksum?: string
          p_customer_id: string
          p_idempotency_key: string
          p_invoice_id: string
          p_issuer_name?: string
          p_notes?: string
          p_payment_id: string
          p_payment_method: Database["public"]["Enums"]["payment_method"]
          p_reference_number?: string
          p_signature_data?: string
          p_signature_hash?: string
        }
        Returns: string
      }
      financial_completeness_evidence_digest: {
        Args: { p_through_date: string }
        Returns: string
      }
      get_customer_account_balances: {
        Args: { p_as_of_date?: string; p_customer_id?: string }
        Returns: {
          as_of_date: string
          credit_notes_applied: number
          customer_code: string
          customer_credits_applied: number
          customer_id: string
          customer_name: string
          invoiced_amount: number
          outstanding_balance: number
          payments_received: number
        }[]
      }
      get_customer_credit_balances: {
        Args: { p_customer_id: string }
        Returns: {
          applied_amount: number
          can_manage: boolean
          credit_amount: number
          credit_note_date: string
          credit_note_id: string
          credit_note_number: string
          original_invoice_id: string
          original_invoice_number: string
          reason: string
          refunded_amount: number
          remaining_amount: number
        }[]
      }
      get_financial_completeness_attestation: {
        Args: never
        Returns: {
          attestation_id: string
          attested_at: string
          attested_by: string
          attested_through: string
          is_current: boolean
          statement: string
        }[]
      }
      get_next_sequence: { Args: { seq_name: string }; Returns: string }
      get_payment_clearing_balances: {
        Args: never
        Returns: {
          account_code: string
          account_name: string
          clearing_balance: number
        }[]
      }
      get_payment_clearing_settlements: {
        Args: never
        Returns: {
          account_code: string
          account_name: string
          bank_reference: string
          created_at: string
          fee_amount: number
          gross_amount: number
          net_amount: number
          notes: string
          provider_reference: string
          settled_on: string
          settlement_id: string
        }[]
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      get_users_with_roles: {
        Args: never
        Returns: {
          avatar_url: string
          created_at: string
          department: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          job_title: string
          phone: string
          roles: Database["public"]["Enums"]["app_role"][]
        }[]
      }
      has_any_role:
        | { Args: { _roles: string[] }; Returns: boolean }
        | { Args: { _user_id: string }; Returns: boolean }
      has_business_role: {
        Args: { p_business_id: string; p_roles: string[] }
        Returns: boolean
      }
      has_permission:
        | { Args: { permission_code: string }; Returns: boolean }
        | {
            Args: { permission_code: string; target_user_id: string }
            Returns: boolean
          }
      has_role:
        | {
            Args: { _role: Database["public"]["Enums"]["app_role"] }
            Returns: boolean
          }
        | {
            Args: {
              _role: Database["public"]["Enums"]["app_role"]
              _user_id: string
            }
            Returns: boolean
          }
      is_business_member: { Args: { p_business_id: string }; Returns: boolean }
      is_first_user: { Args: never; Returns: boolean }
      is_reset_locked: {
        Args: { _email: string; _ip: string }
        Returns: boolean
      }
      issue_invoice: { Args: { p_invoice_id: string }; Returns: string }
      legacy_business_id: { Args: never; Returns: string }
      pay_operating_expense: {
        Args: {
          p_amount: number
          p_expense_id: string
          p_idempotency_key: string
          p_paid_on: string
          p_payment_method: Database["public"]["Enums"]["payment_method"]
          p_reference_number: string
        }
        Returns: string
      }
      post_invoice_journal: { Args: { p_invoice_id: string }; Returns: string }
      post_receipt_journal_by_id: {
        Args: { p_receipt_id: string }
        Returns: undefined
      }
      record_inventory_damage: {
        Args: {
          p_idempotency_key: string
          p_notes?: string
          p_product_id: string
          p_quantity: number
          p_reference_number: string
        }
        Returns: string
      }
      record_invoice_credit_note: {
        Args: {
          p_credit_note_date: string
          p_idempotency_key: string
          p_invoice_id: string
          p_lines: Json
          p_reason: string
          p_reference_number: string
        }
        Returns: string
      }
      record_invoice_item_direct_cost: {
        Args: {
          p_amount: number
          p_incurred_on: string
          p_invoice_item_id: string
          p_notes?: string
          p_payment_method: Database["public"]["Enums"]["payment_method"]
          p_reference: string
        }
        Returns: string
      }
      record_invoice_payment:
        | {
            Args: {
              p_amount: number
              p_customer_id: string
              p_idempotency_key: string
              p_invoice_id: string
              p_notes?: string
              p_payment_method: Database["public"]["Enums"]["payment_method"]
              p_reference_number?: string
            }
            Returns: string
          }
        | {
            Args: {
              p_amount: number
              p_customer_id: string
              p_invoice_id: string
              p_notes?: string
              p_payment_method: Database["public"]["Enums"]["payment_method"]
              p_reference_number?: string
            }
            Returns: string
          }
      record_operating_expense: {
        Args: {
          p_amount: number
          p_amount_paid: number
          p_description: string
          p_due_on: string
          p_expense_account_id: string
          p_idempotency_key: string
          p_incurred_on: string
          p_notes: string
          p_payment_method: Database["public"]["Enums"]["payment_method"]
          p_payment_reference: string
          p_reference_number: string
          p_vendor_name: string
        }
        Returns: string
      }
      record_operating_expense_refund: {
        Args: {
          p_amount: number
          p_expense_id: string
          p_idempotency_key: string
          p_payment_method: Database["public"]["Enums"]["payment_method"]
          p_reference_number: string
          p_refunded_on: string
        }
        Returns: string
      }
      record_stock_count_adjustment: {
        Args: {
          p_counted_on: string
          p_counted_quantity: number
          p_idempotency_key: string
          p_product_id: string
          p_reason: string
          p_reference_number: string
        }
        Returns: string
      }
      record_stock_purchase: {
        Args: {
          p_amount_paid?: number
          p_idempotency_key?: string
          p_notes?: string
          p_opening_unit_cost?: number
          p_payment_method?: Database["public"]["Enums"]["payment_method"]
          p_product_id: string
          p_quantity: number
          p_reference_number?: string
          p_supplier_name?: string
          p_unit_cost: number
        }
        Returns: string
      }
      refund_customer_credit: {
        Args: {
          p_amount: number
          p_credit_note_id: string
          p_idempotency_key: string
          p_payment_method: Database["public"]["Enums"]["payment_method"]
          p_reference_number: string
          p_refunded_on: string
        }
        Returns: string
      }
      register_reset_failure: {
        Args: {
          _email: string
          _ip: string
          _lock_minutes?: number
          _threshold?: number
        }
        Returns: Json
      }
      resolve_payment_account_id: {
        Args: {
          p_payment_method: Database["public"]["Enums"]["payment_method"]
        }
        Returns: string
      }
      reverse_petty_cash_expense: {
        Args: {
          p_idempotency_key: string
          p_payment_method: Database["public"]["Enums"]["payment_method"]
          p_reason: string
          p_reference_number: string
          p_reversed_on: string
          p_transaction_id: string
        }
        Returns: string
      }
      reverse_stock_purchase: {
        Args: {
          p_idempotency_key: string
          p_purchase_transaction_id: string
          p_reason: string
          p_reference_number: string
          p_refund_payment_method: Database["public"]["Enums"]["payment_method"]
          p_reversed_on: string
        }
        Returns: string
      }
      reverse_unpaid_operating_expense: {
        Args: {
          p_expense_id: string
          p_idempotency_key: string
          p_reason: string
          p_reference_number: string
        }
        Returns: string
      }
      set_business_member_access: {
        Args: {
          p_business_id: string
          p_role: string
          p_status?: string
          p_user_id: string
        }
        Returns: string
      }
      set_historical_invoice_item_cost: {
        Args: {
          p_invoice_item_id: string
          p_notes?: string
          p_reference: string
          p_unit_cost: number
        }
        Returns: string
      }
      settle_payment_clearing_account: {
        Args: {
          p_bank_reference: string
          p_clearing_account_code: string
          p_fee_amount: number
          p_gross_amount: number
          p_idempotency_key: string
          p_notes?: string
          p_provider_reference: string
          p_settled_on: string
        }
        Returns: string
      }
      void_receipt_and_reconcile: {
        Args: { receipt_id: string }
        Returns: undefined
      }
    }
    Enums: {
      account_subtype:
        | "current_asset"
        | "fixed_asset"
        | "other_asset"
        | "current_liability"
        | "long_term_liability"
        | "equity"
        | "operating_revenue"
        | "other_revenue"
        | "cost_of_sales"
        | "operating_expense"
        | "other_expense"
      account_type: "asset" | "liability" | "equity" | "revenue" | "expense"
      app_role: "admin" | "accountant" | "cashier" | "auditor"
      audit_action:
        | "create"
        | "update"
        | "delete"
        | "login"
        | "logout"
        | "view"
        | "export"
        | "sign"
      discount_type: "fixed" | "percentage"
      invoice_status:
        | "draft"
        | "issued"
        | "paid"
        | "overdue"
        | "canceled"
        | "partially_paid"
      payment_method:
        | "cash"
        | "credit_card"
        | "debit_card"
        | "bank_transfer"
        | "check"
        | "mobile_payment"
        | "other"
      receipt_status: "issued" | "void"
      tax_type: "vat" | "sales_tax" | "service_tax" | "excise_tax" | "custom"
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
    Enums: {
      account_subtype: [
        "current_asset",
        "fixed_asset",
        "other_asset",
        "current_liability",
        "long_term_liability",
        "equity",
        "operating_revenue",
        "other_revenue",
        "cost_of_sales",
        "operating_expense",
        "other_expense",
      ],
      account_type: ["asset", "liability", "equity", "revenue", "expense"],
      app_role: ["admin", "accountant", "cashier", "auditor"],
      audit_action: [
        "create",
        "update",
        "delete",
        "login",
        "logout",
        "view",
        "export",
        "sign",
      ],
      discount_type: ["fixed", "percentage"],
      invoice_status: [
        "draft",
        "issued",
        "paid",
        "overdue",
        "canceled",
        "partially_paid",
      ],
      payment_method: [
        "cash",
        "credit_card",
        "debit_card",
        "bank_transfer",
        "check",
        "mobile_payment",
        "other",
      ],
      receipt_status: ["issued", "void"],
      tax_type: ["vat", "sales_tax", "service_tax", "excise_tax", "custom"],
    },
  },
} as const
