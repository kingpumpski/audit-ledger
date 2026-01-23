import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { InitialAdminSetup } from "@/components/auth/InitialAdminSetup";

// Pages
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
import Invoices from "./pages/Invoices";
import InvoiceNew from "./pages/InvoiceNew";
import Receipts from "./pages/Receipts";
import ReceiptNew from "./pages/ReceiptNew";
import Customers from "./pages/Customers";
import Products from "./pages/Products";
import AuditLogs from "./pages/AuditLogs";
import Reports from "./pages/Reports";
import AdminUsers from "./pages/AdminUsers";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <InitialAdminSetup />
          <Routes>
            {/* Public Routes */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />

            {/* Protected Routes */}
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/invoices" element={<ProtectedRoute><Invoices /></ProtectedRoute>} />
            <Route path="/invoices/new" element={<ProtectedRoute><InvoiceNew /></ProtectedRoute>} />
            <Route path="/receipts" element={<ProtectedRoute><Receipts /></ProtectedRoute>} />
            <Route path="/receipts/new" element={<ProtectedRoute><ReceiptNew /></ProtectedRoute>} />
            <Route path="/customers/*" element={<ProtectedRoute><Customers /></ProtectedRoute>} />
            <Route path="/products/*" element={<ProtectedRoute><Products /></ProtectedRoute>} />
            <Route path="/audit-logs" element={<ProtectedRoute requiredRoles={['admin', 'auditor']}><AuditLogs /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute requiredRoles={['admin', 'accountant', 'auditor']}><Reports /></ProtectedRoute>} />
            <Route path="/admin/users" element={<ProtectedRoute requiredRoles={['admin']}><AdminUsers /></ProtectedRoute>} />

            {/* Catch-all */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
