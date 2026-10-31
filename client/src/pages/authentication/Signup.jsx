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

export default function Signup() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    businessType: "",
    password: "",
    confirm: "",
  });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [loading, setLoading] = useState(false);

  const update = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const validate = () => {
    const e = {};
    if (form.name.trim().length < 2) e.name = "Enter the customer name.";
    if (!/^\S+@\S+\.\S+$/.test(form.email)) e.email = "Enter a valid email address.";
    const digits = form.phone.replace(/^\+91/, "").replace(/[\s-]/g, "");
    if (!/^[6-9]\d{9}$/.test(digits)) e.phone = "Enter a valid 10-digit mobile number.";
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

    if (!res.ok) return setServerError(res.error);
    navigate("/login", { replace: true });
  };

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
            <input {...p} name="email" type="email" autoComplete="email" value={form.email} onChange={update} />
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

        <div className="row-2">
          <FormField label="Password" error={errors.password}>
            {(p) => (
              <input {...p} name="password" type="password" autoComplete="new-password" value={form.password} onChange={update} />
            )}
          </FormField>

          <FormField label="Confirm password" error={errors.confirm}>
            {(p) => (
              <input {...p} name="confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={update} />
            )}
          </FormField>
        </div>

        {serverError && (
          <div className="form-alert" role="alert">
            {serverError}
          </div>
        )}

        <button className="btn-primary" type="submit" disabled={loading}>
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>
    </AuthLayout>
  );
}