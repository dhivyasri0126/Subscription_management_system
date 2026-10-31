import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthLayout from "../../components/authentication/AuthLayout";
import FormField from "../../components/authentication/FormField";
import { useAuth } from "./AuthContext";
import { ROLE_HOME } from "./roles";

const USER_TYPES = ["admin", "staff", "customer"];

const EyeIcon = ({ off }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
    {off && <path d="M4 4l16 16" />}
  </svg>
);

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ identifier: "", password: "", role: "customer" });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const update = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const validate = () => {
    const e = {};
    if (!/^\S+@\S+\.\S+$/.test(form.identifier.trim())) e.identifier = "Enter your email address.";
    if (!form.password) e.password = "Enter your password.";
    return e;
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    setServerError("");
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;

    setLoading(true);
    const res = await login(form);
    setLoading(false);

    if (!res.ok) return setServerError(res.error);
    navigate(ROLE_HOME[res.user.role], { replace: true }); // admin -> /admin, staff -> /staff, customer -> /customer
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Choose how you use the system, then sign in."
      footer={
        <>
          New customer? <Link to="/signup">Create an account</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        <fieldset className="segmented">
          <legend>Log in as</legend>
          <div className="segmented-track" style={{ "--i": USER_TYPES.indexOf(form.role) }}>
            {USER_TYPES.map((t) => (
              <label key={t} className={form.role === t ? "active" : ""}>
                <input type="radio" name="role" value={t} checked={form.role === t} onChange={update} />
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </label>
            ))}
          </div>
        </fieldset>

        <FormField label="Email address" error={errors.identifier}>
          {(p) => (
            <input
              {...p}
              name="identifier"
              type="email"
              autoComplete="username"
              value={form.identifier}
              onChange={update}
              placeholder="you@company.com"
            />
          )}
        </FormField>

        <FormField label="Password" error={errors.password}>
          {(p) => (
            <div className="pw-wrap">
              <input
                {...p}
                name="password"
                type={showPw ? "text" : "password"}
                autoComplete="current-password"
                value={form.password}
                onChange={update}
                placeholder="Enter your password"
              />
              <button
                type="button"
                className="pw-toggle"
                onClick={() => setShowPw(!showPw)}
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                <EyeIcon off={showPw} />
              </button>
            </div>
          )}
        </FormField>

        {serverError && (
          <div className="form-alert" role="alert">
            {serverError}
          </div>
        )}

        <button className="btn-primary" type="submit" disabled={loading}>
          {loading && <span className="spinner" aria-hidden="true" />}
          {loading ? "Logging in…" : "Log in"}
        </button>
      </form>
    </AuthLayout>
  );
}