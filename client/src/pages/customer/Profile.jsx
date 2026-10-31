import { useState } from "react";
import { customerApi } from "../../services/customerApi";
import { useAsync } from "../../components/customer/useAsync";
import { PageHeader, Loading, ErrorBox } from "../../components/customer/common";

const BUSINESS_TYPES = ["Retail", "Restaurant / Food", "Healthcare", "Education", "IT / Software", "Manufacturing", "Services", "Other"];

function ProfileForm({ profile }) {
  const [form, setForm] = useState({
    name: profile.name || "",
    phone: profile.phone || "",
    address: profile.address || "",
    businessType: profile.business_type || "",
  });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState({ type: "", text: "" });
  const [saving, setSaving] = useState(false);

  const update = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  const types = form.businessType && !BUSINESS_TYPES.includes(form.businessType) ? [...BUSINESS_TYPES, form.businessType] : BUSINESS_TYPES;

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setMessage({ type: "", text: "" });
    try {
      await customerApi.updateProfile(form);
      setMessage({ type: "ok", text: "Profile saved." });
    } catch (err) {
      setErrors(err.fields || {});
      setMessage({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const field = (name, label, control) => (
    <div className={`cx-field ${errors[name] ? "has-error" : ""}`}>
      <label htmlFor={name}>{label}</label>
      {control}
      {errors[name] && <span className="cx-field-error">{errors[name]}</span>}
    </div>
  );

  return (
    <form className="cx-card cx-form" onSubmit={save} noValidate>
      {field("email", "Email address", <input id="email" value={profile.email} disabled />)}
      {field("name", "Customer name", <input id="name" name="name" value={form.name} onChange={update} />)}
      {field("phone", "Phone number", <input id="phone" name="phone" type="tel" value={form.phone} onChange={update} />)}
      {field(
        "businessType",
        "Business type",
        <select id="businessType" name="businessType" value={form.businessType} onChange={update}>
          <option value="">Select…</option>
          {types.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      )}
      {field("address", "Address", <textarea id="address" name="address" rows="3" value={form.address} onChange={update} />)}

      {message.text && (
        <div className={`cx-alert ${message.type === "ok" ? "cx-alert--ok" : "cx-alert--error"}`} role="status">
          {message.text}
        </div>
      )}
      <button className="cx-btn cx-btn--primary" disabled={saving}>
        {saving ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

export default function Profile() {
  const { loading, error, data } = useAsync(() => customerApi.getProfile(), []);
  return (
    <>
      <PageHeader title="My profile" subtitle="Keep your contact and business details up to date." />
      {loading ? <Loading /> : error ? <ErrorBox message={error} /> : <ProfileForm profile={data.profile} />}
    </>
  );
}