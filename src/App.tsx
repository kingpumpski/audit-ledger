import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";

// Pages
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
import Invoices from "./pages/Invoices";
import Receipts from "./pages/Receipts";
import Customers from "./pages/Customers";
import Products from "./pages/Products";
import Accounting from "./pages/Accounting";
import Taxes from "./pages/Taxes";
import Discounts from "./pages/Discounts";
import AuditLogs from "./pages/AuditLogs";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Profile from "./pages/Profile";
import Notifications from "./pages/Notifications";
import NotFound from "./pages/NotFound";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import ResetSuccess from "./pages/ResetSuccess";
import ResetExpired from "./pages/ResetExpired";
import ResetInvalid from "./pages/ResetInvalid";
import HelpPasswordReset from "./pages/HelpPasswordReset";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public Routes */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/reset-success" element={<ResetSuccess />} />
            <Route path="/reset-expired" element={<ResetExpired />} />
            <Route path="/reset-invalid" element={<ResetInvalid />} />
            <Route path="/help/password-reset" element={<HelpPasswordReset />} />

            {/* Protected Routes */}
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/invoices/*" element={<ProtectedRoute><Invoices /></ProtectedRoute>} />
            <Route path="/receipts/*" element={<ProtectedRoute><Receipts /></ProtectedRoute>} />
            <Route path="/customers/*" element={<ProtectedRoute><Customers /></ProtectedRoute>} />
            <Route path="/products/*" element={<ProtectedRoute><Products /></ProtectedRoute>} />
            <Route path="/accounting/*" element={<ProtectedRoute requiredRoles={['admin','accountant','auditor']}><Accounting /></ProtectedRoute>} />
            <Route path="/taxes" element={<ProtectedRoute requiredRoles={['admin','accountant']}><Taxes /></ProtectedRoute>} />
            <Route path="/discounts" element={<ProtectedRoute requiredRoles={['admin','accountant']}><Discounts /></ProtectedRoute>} />
            <Route path="/audit-logs" element={<ProtectedRoute requiredRoles={['admin','auditor']}><AuditLogs /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute requiredRoles={['admin','accountant','auditor']}><Reports /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />

            {/* Catch-all */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
