import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { CurrencyProvider } from "@/contexts/CurrencyContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { InitialAdminSetup } from "@/components/auth/InitialAdminSetup";

const Login = lazy(() => import("./pages/Login"));
const Signup = lazy(() => import("./pages/Signup"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Invoices = lazy(() => import("./pages/Invoices"));
const InvoiceNew = lazy(() => import("./pages/InvoiceNew"));
const InvoiceDetails = lazy(() => import("./pages/InvoiceDetails"));
const Receipts = lazy(() => import("./pages/Receipts"));
const ReceiptNew = lazy(() => import("./pages/ReceiptNew"));
const ReceiptDetails = lazy(() => import("./pages/ReceiptDetails"));
const Customers = lazy(() => import("./pages/Customers"));
const CustomerDetails = lazy(() => import("./pages/CustomerDetails"));
const Products = lazy(() => import("./pages/Products"));
const Taxes = lazy(() => import("./pages/Taxes"));
const Discounts = lazy(() => import("./pages/Discounts"));
const AuditLogs = lazy(() => import("./pages/AuditLogs"));
const Reports = lazy(() => import("./pages/Reports"));
const AdminUsers = lazy(() => import("./pages/AdminUsers"));
const Profile = lazy(() => import("./pages/Profile"));
const Settings = lazy(() => import("./pages/Settings"));
const Accounting = lazy(() => import("./pages/Accounting"));
const Inventory = lazy(() => import("./pages/Inventory"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <CurrencyProvider>
            <InitialAdminSetup />
          <Suspense fallback={<div className="flex min-h-screen items-center justify-center" role="status">Loading page...</div>}>
            <Routes>
              {/* Public Routes */}
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />

              {/* Protected Routes */}
              <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/invoices" element={<ProtectedRoute><Invoices /></ProtectedRoute>} />
              <Route path="/invoices/new" element={<ProtectedRoute><InvoiceNew /></ProtectedRoute>} />
              <Route path="/invoices/:id" element={<ProtectedRoute><InvoiceDetails /></ProtectedRoute>} />
              <Route path="/receipts" element={<ProtectedRoute><Receipts /></ProtectedRoute>} />
              <Route path="/receipts/new" element={<ProtectedRoute><ReceiptNew /></ProtectedRoute>} />
              <Route path="/receipts/:id" element={<ProtectedRoute><ReceiptDetails /></ProtectedRoute>} />
              <Route path="/customers" element={<ProtectedRoute><Customers /></ProtectedRoute>} />
              <Route path="/customers/:id" element={<ProtectedRoute><CustomerDetails /></ProtectedRoute>} />
              <Route path="/products" element={<ProtectedRoute><Products /></ProtectedRoute>} />
              <Route path="/inventory" element={<ProtectedRoute requiredRoles={['admin', 'accountant', 'cashier']}><Inventory /></ProtectedRoute>} />
              <Route path="/accounting" element={<ProtectedRoute requiredRoles={['admin', 'accountant']}><Accounting /></ProtectedRoute>} />
              <Route path="/taxes" element={<ProtectedRoute requiredRoles={['admin', 'accountant']}><Taxes /></ProtectedRoute>} />
              <Route path="/discounts" element={<ProtectedRoute requiredRoles={['admin', 'accountant']}><Discounts /></ProtectedRoute>} />
              <Route path="/audit-logs" element={<ProtectedRoute requiredRoles={['admin', 'auditor']}><AuditLogs /></ProtectedRoute>} />
              <Route path="/reports" element={<ProtectedRoute requiredRoles={['admin', 'accountant', 'auditor']}><Reports /></ProtectedRoute>} />
              <Route path="/admin/users" element={<ProtectedRoute requiredRoles={['admin']}><AdminUsers /></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute requiredRoles={['admin']}><Settings /></ProtectedRoute>} />
              <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />

              {/* Catch-all */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          </CurrencyProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
