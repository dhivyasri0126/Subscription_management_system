import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./pages/authentication/AuthContext";
import ProtectedRoute from "./pages/authentication/ProtectedRoute";
import Login from "./pages/authentication/Login";
import Signup from "./pages/authentication/Signup";

import AdminDashboard from "./pages/admin/AdminDashboard";
import CustomerDashboard from "./pages/customer/CustomerDashboard";

// Staff portal
import StaffLayout from "./pages/staff/portal/StaffLayout";
import StaffDashboard from "./pages/staff/StaffDashboard";
import StaffQuotations from "./pages/staff/portal/StaffQuotations";
import StaffSubscriptions from "./pages/staff/portal/StaffSubscriptions";
import StaffSubscriptionDetail from "./pages/staff/portal/StaffSubscriptionDetail";
import StaffInvoices from "./pages/staff/portal/StaffInvoices";
import StaffInvoiceDetail from "./pages/staff/portal/StaffInvoiceDetail";
import StaffReceipt from "./pages/staff/portal/StaffReceipt";

import "./App.css";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />

          <Route
            path="/admin"
            element={
              <ProtectedRoute allow={["admin"]}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />

          {/* Staff: one guarded layout (sidebar) with pages rendered inside it */}
          <Route
            path="/staff"
            element={
              <ProtectedRoute allow={["staff"]}>
                <StaffLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<StaffDashboard />} />
            <Route path="quotations" element={<StaffQuotations />} />
            <Route path="subscriptions" element={<StaffSubscriptions />} />
            <Route path="subscriptions/:id" element={<StaffSubscriptionDetail />} />
            <Route path="invoices" element={<StaffInvoices />} />
            <Route path="invoices/:id" element={<StaffInvoiceDetail />} />
            <Route path="receipts/:id" element={<StaffReceipt />} />
          </Route>

          <Route
            path="/customer"
            element={
              <ProtectedRoute allow={["customer"]}>
                <CustomerDashboard />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}