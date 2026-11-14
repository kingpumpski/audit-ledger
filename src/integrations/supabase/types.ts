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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
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
        Relationships: []
      }
      chart_of_accounts: {
        Row: {
          account_subtype: Database["public"]["Enums"]["account_subtype"] | null
          account_type: Database["public"]["Enums"]["account_type"]
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
            foreignKeyName: "chart_of_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      company_settings: {
        Row: {
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
        Relationships: []
      }
      customers: {
        Row: {
          address_line1: string | null
          address_line2: string | null
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
        Relationships: []
      }
      discounts: {
        Row: {
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
        Relationships: []
      }
      inventory_transactions: {
        Row: {
          created_at: string
          id: string
          new_quantity: number | null
          supplier_name: string | null
          reference_number: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          amount_paid: number
          notes: string | null
          performed_by: string | null
          previous_quantity: number | null
          product_id: string
          quantity: number
          reference_id: string | null
          reference_type: string | null
          total_cost: number | null
          type: string
          unit_cost: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          new_quantity?: number | null
          supplier_name?: string | null
          reference_number?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          amount_paid?: number
          notes?: string | null
          performed_by?: string | null
          previous_quantity?: number | null
          product_id: string
          quantity: number
          reference_id?: string | null
          reference_type?: string | null
          total_cost?: number | null
          type: string
          unit_cost?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          new_quantity?: number | null
          notes?: string | null
          performed_by?: string | null
          previous_quantity?: number | null
          product_id?: string
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
          total_cost?: number | null
          type?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
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
          unit_price: number
          unit_cost: number | null
          cost_source: string | null
          cost_verified_by: string | null
          cost_verified_at: string | null
          cost_reference: string | null
          cost_notes: string | null
        }
        Insert: {
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
          unit_price: number
          unit_cost?: number | null
          cost_source?: string | null
          cost_verified_by?: string | null
          cost_verified_at?: string | null
          cost_reference?: string | null
          cost_notes?: string | null
        }
        Update: {
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
          unit_price?: number
          unit_cost?: number | null
          cost_source?: string | null
          cost_verified_by?: string | null
          cost_verified_at?: string | null
          cost_reference?: string | null
          cost_notes?: string | null
        }
        Relationships: [
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
        ]
      }
      invoice_item_taxes: {
        Row: {
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
            foreignKeyName: "invoice_item_taxes_tax_id_fkey"
            columns: ["tax_id"]
            isOneToOne: false
            referencedRelation: "taxes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_item_taxes_liability_account_id_fkey"
            columns: ["liability_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_taxes: {
        Row: {
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
            foreignKeyName: "invoice_taxes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_taxes_tax_id_fkey"
            columns: ["tax_id"]
            isOneToOne: false
            referencedRelation: "taxes"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
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
        Relationships: []
      }
      journal_lines: {
        Row: {
          account_id: string
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
            foreignKeyName: "journal_lines_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_paid: number | null
          balance_due: number | null
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
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean | null
          link: string | null
          message: string
          read_at: string | null
          title: string
          type: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean | null
          link?: string | null
          message: string
          read_at?: string | null
          title: string
          type?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean | null
          link?: string | null
          message?: string
          read_at?: string | null
          title?: string
          type?: string | null
          user_id?: string
        }
        Relationships: []
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
      payments: {
        Row: {
          amount: number
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
      petty_cash_transactions: {
        Row: {
          amount: number
          category: string | null
          created_at: string
          date: string
          description: string
          id: string
          recorded_by: string | null
          reference_number: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          type: string
          updated_at: string
        }
        Insert: {
          amount: number
          category?: string | null
          created_at?: string
          date?: string
          description: string
          id?: string
          recorded_by?: string | null
          reference_number?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          type: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string
          date?: string
          description?: string
          id?: string
          recorded_by?: string | null
          reference_number?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      product_price_history: {
        Row: {
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
            foreignKeyName: "product_price_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string | null
          cost_price: number | null
          cost_price_verified: boolean
          created_at
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
          category?: string | null
          cost_price?: number | null
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
        Relationships: []
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
          current_value: number | null
          name: string
          padding: number | null
          prefix: string
          updated_at: string
        }
        Insert: {
          current_value?: number | null
          name: string
          padding?: number | null
          prefix: string
          updated_at?: string
        }
        Update: {
          current_value?: number | null
          name?: string
          padding?: number | null
          prefix?: string
          updated_at?: string
        }
        Relationships: []
      }
      taxes: {
        Row: {
          applies_to_category: string | null
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
        Relationships: []
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
      assign_user_role: {
        Args: {
          granted_by_user: string
          role_name: Database["public"]["Enums"]["app_role"]
          target_user: string
        }
        Returns: undefined
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
      get_next_sequence: { Args: { seq_name: string }; Returns: string }
      create_invoice_draft: {
        Args: {
          p_customer_id: string
          p_issue_date: string
          p_due_date: string | null
          p_notes: string | null
          p_terms: string | null
          p_prices_include_tax: boolean
          p_subtotal: number
          p_discount_amount: number
          p_tax_amount: number
          p_total_amount: number
          p_items: Json
        }
        Returns: string
      }
      issue_invoice: { Args: { p_invoice_id: string }; Returns: string }
      record_stock_purchase: {
        Args: {
          p_product_id: string
          p_quantity: number
          p_unit_cost: number
          p_supplier_name?: string | null
          p_reference_number?: string | null
          p_amount_paid?: number
          p_payment_method?: Database["public"]["Enums"]["payment_method"]
          p_notes?: string | null
          p_opening_unit_cost?: number | null
          p_idempotency_key: string
        }
        Returns: string
      }
      record_inventory_damage: {
        Args: {
          p_product_id: string
          p_quantity: number
          p_reference_number: string
          p_idempotency_key: string
          p_notes?: string | null
        }
        Returns: string
      }
      record_stock_count_adjustment: {
        Args: {
          p_product_id: string
          p_counted_quantity: number
          p_counted_on: string
          p_reason: string
          p_reference_number: string
          p_idempotency_key: string
        }
        Returns: string
      }
      reverse_stock_purchase: {
        Args: {
          p_purchase_transaction_id: string
          p_reversed_on: string
          p_refund_payment_method: Database["public"]["Enums"]["payment_method"] | null
          p_reason: string
          p_reference_number: string
          p_idempotency_key: string
        }
        Returns: string
      }
      set_historical_invoice_item_cost: {
        Args: {
          p_invoice_item_id: string
          p_unit_cost: number
          p_reference: string
          p_notes?: string | null
        }
        Returns: string
      }
      record_invoice_payment: {
        Args: {
          p_invoice_id: string
          p_customer_id: string
          p_amount: number
          p_payment_method: Database["public"]["Enums"]["payment_method"]
          p_reference_number?: string | null
          p_notes?: string | null
          p_idempotency_key: string
        }
        Returns: string
      }
      get_customer_account_balances: {
        Args: { p_as_of_date?: string; p_customer_id?: string | null }
        Returns: {
          customer_id: string
          customer_code: string
          customer_name: string
          invoiced_amount: number
          payments_received: number
          credit_notes_applied: number
          customer_credits_applied: number
          outstanding_balance: number
          as_of_date: string
        }[]
      }
      get_payment_clearing_balances: {
        Args: never
        Returns: { account_code: string; account_name: string; clearing_balance: number }[]
      }
      settle_payment_clearing_account: {
        Args: {
          p_clearing_account_code: string
          p_gross_amount: number
          p_fee_amount: number
          p_settled_on: string
          p_provider_reference: string
          p_bank_reference: string
          p_idempotency_key: string
          p_notes?: string | null
        }
        Returns: string
      }
      create_receipt_with_payment: {
        Args: {
          p_customer_id: string
          p_invoice_id: string | null
          p_payment_id: string | null
          p_amount: number
          p_payment_method: Database["public"]["Enums"]["payment_method"]
          p_idempotency_key: string
          p_notes?: string | null
          p_signature_data?: string | null
          p_signature_hash?: string | null
          p_checksum?: string | null
          p_issuer_name?: string | null
          p_reference_number?: string | null
        }
        Returns: string
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
        | { Args: { _user_id: string }; Returns: boolean }
        | { Args: { roles: string[] }; Returns: boolean }
      has_permission: { Args: { permission_code: string }; Returns: boolean }
      has_role:
        | {
            Args: {
              _role: Database["public"]["Enums"]["app_role"]
              _user_id: string
            }
            Returns: boolean
          }
        | { Args: { role_name: string }; Returns: boolean }
      is_first_user: { Args: never; Returns: boolean }
      is_reset_locked: {
        Args: { _email: string; _ip: string }
        Returns: boolean
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
      void_receipt_and_reconcile: {
        Args: { receipt_id: string }
        Returns: undefined
      }
      verify_cron_token: {
        Args: { _name: string; _token: string }
        Returns: boolean
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
        | "INSERT"
        | "UPDATE"
        | "DELETE"
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
        "INSERT",
        "UPDATE",
        "DELETE",
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
