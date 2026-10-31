import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthLayout from "../../components/authentication/AuthLayout";
import FormField from "../../components/authentication/FormField";
import { useAuth } from "./AuthContext";

const USER_TYPES = ["admin", "staff", "customer"];

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
    if (!form.identifier.trim()) e.identifier = "Enter your username or email.";
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
    navigate("/dashboard", { replace: true });
  };

  return (
    <AuthLayout
      title="Log in"
      subtitle="Welcome back. Choose how you use the system and sign in."
      footer={
        <>
          New customer? <Link to="/signup">Create an account</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        <fieldset className="segmented">
          <legend>Log in as</legend>
          {USER_TYPES.map((t) => (
            <label key={t} className={form.role === t ? "active" : ""}>
              <input
                type="radio"
                name="role"
                value={t}
                checked={form.role === t}
                onChange={update}
              />
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </label>
          ))}
        </fieldset>

        <FormField label="Username or email" error={errors.identifier}>
          {(p) => (
            <input
              {...p}
              name="identifier"
              type="text"
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
              />
              <button type="button" className="pw-toggle" onClick={() => setShowPw(!showPw)}>
                {showPw ? "Hide" : "Show"}
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
          {loading ? "Logging in…" : "Log in"}
        </button>

        <p className="demo-hint">Demo: admin / admin123 · staff / staff123</p>
      </form>
    </AuthLayout>
  );
}