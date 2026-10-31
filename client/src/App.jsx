
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./pages/authentication/AuthContext";
import ProtectedRoute from "./pages/authentication/ProtectedRoute";
import Login from "./pages/authentication/Login";
import Signup from "./pages/authentication/Signup";

import AdminDashboard from "./pages/admin/AdminDashboard";

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

          {/* Admin portal */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute allow={["admin"]}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />

          {/* Staff portal */}
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
            <Route
              path="subscriptions/:id"
              element={<StaffSubscriptionDetail />}
            />
            <Route path="invoices" element={<StaffInvoices />} />
            <Route path="invoices/:id" element={<StaffInvoiceDetail />} />
            <Route path="receipts/:id" element={<StaffReceipt />} />
          </Route>

          {/* Customer portal */}
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
            <Route
              path="subscriptions/:id"
              element={<SubscriptionDetail />}
            />
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
