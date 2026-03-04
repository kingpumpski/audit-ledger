import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { CurrencyProvider } from "@/contexts/CurrencyContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { InitialAdminSetup } from "@/components/auth/InitialAdminSetup";

// Pages
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import Invoices from "./pages/Invoices";
import InvoiceNew from "./pages/InvoiceNew";
import InvoiceDetails from "./pages/InvoiceDetails";
import Receipts from "./pages/Receipts";
import ReceiptNew from "./pages/ReceiptNew";
import ReceiptDetails from "./pages/ReceiptDetails";
import Customers from "./pages/Customers";
import CustomerDetails from "./pages/CustomerDetails";
import Products from "./pages/Products";
import Taxes from "./pages/Taxes";
import Discounts from "./pages/Discounts";
import AuditLogs from "./pages/AuditLogs";
import Reports from "./pages/Reports";
import AdminUsers from "./pages/AdminUsers";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import Accounting from "./pages/Accounting";
import Inventory from "./pages/Inventory";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <CurrencyProvider>
            <InitialAdminSetup />
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
          </CurrencyProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
