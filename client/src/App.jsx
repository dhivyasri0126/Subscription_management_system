import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./pages/authentication/AuthContext";
import ProtectedRoute from "./pages/authentication/ProtectedRoute";
import Login from "./pages/authentication/Login";
import Signup from "./pages/authentication/Signup";

// Admin and staff dashboards (rename to your real page files if different)
import AdminDashboard from "./pages/admin/AdminDashboard";
import StaffDashboard from "./pages/staff/StaffDashboard";

// Customer portal
import CustomerLayout from "./components/customer/CustomerLayout";
import CustomerDashboard from "./pages/customer/CustomerDashboard";
import RequestQuotation from "./pages/customer/RequestQuotation";
import Subscriptions from "./pages/customer/Subscriptions";
import SubscriptionDetail from "./pages/customer/SubscriptionDetail";
import Invoices from "./pages/customer/Invoices";
import InvoiceDetail from "./pages/customer/InvoiceDetail";
import Receipts from "./pages/customer/Receipts";
import ReceiptDetail from "./pages/customer/ReceiptDetail";
import Profile from "./pages/customer/Profile";

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
          <Route
            path="/staff"
            element={
              <ProtectedRoute allow={["staff"]}>
                <StaffDashboard />
              </ProtectedRoute>
            }
          />

          {/* Customer portal: one layout (sidebar) wrapping all customer pages */}
          <Route
            path="/customer"
            element={
              <ProtectedRoute allow={["customer"]}>
                <CustomerLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<CustomerDashboard />} />
            <Route path="request" element={<RequestQuotation />} />
            <Route path="subscriptions" element={<Subscriptions />} />
            <Route path="subscriptions/:id" element={<SubscriptionDetail />} />
            <Route path="invoices" element={<Invoices />} />
            <Route path="invoices/:id" element={<InvoiceDetail />} />
            <Route path="receipts" element={<Receipts />} />
            <Route path="receipts/:id" element={<ReceiptDetail />} />
            <Route path="profile" element={<Profile />} />
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}