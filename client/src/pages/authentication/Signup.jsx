import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthLayout from "../../components/authentication/AuthLayout";
import FormField from "../../components/authentication/FormField";
import { useAuth } from "./AuthContext";

const BUSINESS_TYPES = [
  "Retail",
  "Restaurant / Food",
  "Healthcare",
  "Education",
  "IT / Software",
  "Manufacturing",
  "Services",
  "Other",
];

const EyeIcon = ({ off }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
    {off && <path d="M4 4l16 16" />}
  </svg>
);

export default function Signup() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    businessType: "",
    password: "",
    confirm: "",
  });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const update = (e) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: value });
    if (errors[name]) setErrors({ ...errors, [name]: undefined }); // clear error as the user fixes it
  };

  const validate = () => {
    const e = {};
    if (form.name.trim().length < 2) e.name = "Enter the customer name.";
    if (!/^\S+@\S+\.\S+$/.test(form.email)) e.email = "Enter a valid email address.";
    const digits = form.phone.replace(/^\+91/, "").replace(/[\s-]/g, "");
    if (!/^[6-9]\d{9}$/.test(digits)) e.phone = "Enter a valid 10-digit mobile number.";
    if (form.address.trim().length < 5) e.address = "Enter your address.";
    if (!form.businessType) e.businessType = "Select your business type.";
    if (form.password.length < 8) e.password = "Use at least 8 characters.";
    if (form.confirm !== form.password) e.confirm = "Passwords do not match.";
    return e;
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    setServerError("");
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;

    setLoading(true);
    const res = await register(form);
    setLoading(false);

    if (!res.ok) {
      if (res.fields) setErrors(res.fields); // e.g. "This email is already registered."
      return setServerError(res.error);
    }
    navigate("/login", { replace: true });
  };

  const passwordInput = (name, autoComplete) => (p) => (
    <div className="pw-wrap">
      <input
        {...p}
        name={name}
        type={showPw ? "text" : "password"}
        autoComplete={autoComplete}
        value={form[name]}
        onChange={update}
      />
      <button
        type="button"
        className="pw-toggle"
        onClick={() => setShowPw(!showPw)}
        aria-label={showPw ? "Hide passwords" : "Show passwords"}
      >
        <EyeIcon off={showPw} />
      </button>
    </div>
  );

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Set up a customer account to manage your subscriptions."
      footer={
        <>
          Already have an account? <Link to="/login">Log in</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        <FormField label="Customer name" error={errors.name}>
          {(p) => (
            <input {...p} name="name" type="text" autoComplete="name" value={form.name} onChange={update} />
          )}
        </FormField>

        <FormField label="Email address" error={errors.email}>
          {(p) => (
            <input
              {...p}
              name="email"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={update}
              placeholder="you@company.com"
            />
          )}
        </FormField>

        <div className="row-2">
          <FormField label="Phone number" error={errors.phone}>
            {(p) => (
              <input
                {...p}
                name="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                value={form.phone}
                onChange={update}
                placeholder="98765 43210"
              />
            )}
          </FormField>

          <FormField label="Business type" error={errors.businessType}>
            {(p) => (
              <select {...p} name="businessType" value={form.businessType} onChange={update}>
                <option value="">Select…</option>
                {BUSINESS_TYPES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        </div>

        <FormField label="Address" error={errors.address}>
          {(p) => (
            <input
              {...p}
              name="address"
              type="text"
              autoComplete="street-address"
              value={form.address}
              onChange={update}
              placeholder="Street, area, city, pincode"
            />
          )}
        </FormField>

        <div className="row-2">
          <FormField label="Password" error={errors.password}>
            {passwordInput("password", "new-password")}
          </FormField>

          <FormField label="Confirm password" error={errors.confirm}>
            {passwordInput("confirm", "new-password")}
          </FormField>
        </div>

        {serverError && (
          <div className="form-alert" role="alert">
            {serverError}
          </div>
        )}

        <button className="btn-primary" type="submit" disabled={loading}>
          {loading && <span className="spinner" aria-hidden="true" />}
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>
    </AuthLayout>
  );
}