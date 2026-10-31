import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { customerApi } from "../../services/customerApi";
import { useAsync } from "../../components/customer/useAsync";
import { formatDate, formatMoney, periodLabel, toCents } from "../../components/customer/format";
import { PageHeader, Loading, ErrorBox, EmptyState } from "../../components/customer/common";

export default function RequestQuotation() {
  const navigate = useNavigate();
  const { loading, error, data } = useAsync(() => Promise.all([customerApi.plans(), customerApi.products()]), []);

  const [planId, setPlanId] = useState("");
  const [qty, setQty] = useState({}); // productId -> quantity (0 / missing = not selected)
  const [variantChoice, setVariantChoice] = useState({}); // productId -> variantId
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} />;

  const plans = data[0].plans;
  const products = data[1].products;
  const plan = plans.find((p) => String(p.id) === String(planId));
  const minQty = plan?.min_quantity ?? 1;

  /* ----- selection handlers ----- */
  const choosePlan = (id) => {
    setPlanId(id);
    const min = plans.find((p) => String(p.id) === String(id))?.min_quantity ?? 1;
    // Lift any already-selected quantity up to this plan's minimum.
    setQty((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, v > 0 ? Math.max(v, min) : v])));
  };
  const setQuantity = (productId, value) => {
    const n = Math.max(0, Math.min(10000, Number.parseInt(value, 10) || 0));
    setQty((prev) => ({ ...prev, [productId]: n }));
  };
  const increase = (id) => setQuantity(id, (qty[id] || 0) === 0 ? minQty : qty[id] + 1);
  const decrease = (id) => setQuantity(id, qty[id] <= minQty ? 0 : qty[id] - 1);

  /* ----- price preview (the server recalculates everything on submit) ----- */
  const lines = products
    .filter((p) => qty[p.id] > 0)
    .map((p) => {
      const variant = p.variants.find((v) => String(v.id) === String(variantChoice[p.id]));
      const unit = toCents(p.sales_price) + (variant ? toCents(variant.extra_price) : 0);
      const amount = unit * qty[p.id];
      const tax = Math.round((amount * Number(p.tax_rate_percent)) / 100);
      return { product: p, variant, quantity: qty[p.id], unit, amount, tax };
    });
  const untaxed = lines.reduce((s, l) => s + l.amount, 0);
  const tax = lines.reduce((s, l) => s + l.tax, 0);
  const belowMin = lines.some((l) => l.quantity < minQty);

  const canSubmit = plan && lines.length > 0 && !belowMin && !submitting;

  const submit = async () => {
    setServerError("");
    setSubmitting(true);
    try {
      const res = await customerApi.createQuotation({
        planId,
        notes,
        lines: lines.map((l) => ({
          productId: l.product.id,
          variantId: l.variant ? l.variant.id : undefined,
          quantity: l.quantity,
        })),
      });
      navigate(`/customer/subscriptions/${res.subscription.id}`, { state: { justCreated: true } });
    } catch (err) {
      setServerError(err.fields?.lines || err.fields?.planId || err.message);
      setSubmitting(false);
    }
  };

  if (plans.length === 0) {
    return (
      <>
        <PageHeader title="Request a quotation" />
        <EmptyState title="No plans are open right now" text="Please check back soon." />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Request a quotation" subtitle="Pick a plan, choose your products, and our team will review it." />

      <div className="cx-request">
        <div className="cx-request-main">
          <section className="cx-card">
            <h2>1. Choose a plan</h2>
            <div className="cx-plans" role="radiogroup" aria-label="Plans">
              {plans.map((p) => (
                <label key={p.id} className={`cx-plan ${String(planId) === String(p.id) ? "selected" : ""}`}>
                  <input type="radio" name="plan" checked={String(planId) === String(p.id)} onChange={() => choosePlan(p.id)} />
                  <strong>{p.name}</strong>
                  <span className="cx-plan-price">
                    {formatMoney(p.price)} <small>/ {periodLabel(p.billing_period)}</small>
                  </span>
                  <small>
                    Min. quantity {p.min_quantity}
                    {p.available_to ? ` · until ${formatDate(p.available_to)}` : ""}
                  </small>
                </label>
              ))}
            </div>
          </section>

          <section className="cx-card">
            <h2>2. Choose products</h2>
            {products.length === 0 ? (
              <EmptyState title="No products available yet" />
            ) : (
              <ul className="cx-products">
                {products.map((p) => {
                  const q = qty[p.id] || 0;
                  return (
                    <li key={p.id} className={q > 0 ? "selected" : ""}>
                      <div className="cx-product-info">
                        <strong>{p.name}</strong>
                        <small>
                          {formatMoney(p.sales_price)}
                          {Number(p.tax_rate_percent) > 0 ? ` + ${Number(p.tax_rate_percent)}% tax` : ""}
                        </small>
                        {p.notes && <small className="cx-muted">{p.notes}</small>}
                      </div>

                      {p.variants.length > 0 && (
                        <select
                          aria-label={`Option for ${p.name}`}
                          value={variantChoice[p.id] || ""}
                          onChange={(e) => setVariantChoice({ ...variantChoice, [p.id]: e.target.value })}
                        >
                          <option value="">Standard</option>
                          {p.variants.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.attribute}: {v.value}
                              {Number(v.extra_price) ? ` (+${formatMoney(v.extra_price)})` : ""}
                            </option>
                          ))}
                        </select>
                      )}

                      <div className="cx-stepper">
                        <button type="button" onClick={() => decrease(p.id)} disabled={q === 0} aria-label={`Decrease ${p.name}`}>
                          −
                        </button>
                        <input
                          type="number"
                          min="0"
                          value={q}
                          onChange={(e) => setQuantity(p.id, e.target.value)}
                          aria-label={`Quantity of ${p.name}`}
                        />
                        <button type="button" onClick={() => increase(p.id)} aria-label={`Increase ${p.name}`}>
                          +
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="cx-card">
            <h2>3. Notes (optional)</h2>
            <textarea
              rows="3"
              maxLength={500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything our team should know?"
            />
          </section>
        </div>

        <aside className="cx-card cx-summary">
          <h2>Your request</h2>
          {plan ? (
            <p className="cx-muted">
              {plan.name} · {formatMoney(plan.price)} / {periodLabel(plan.billing_period)}
            </p>
          ) : (
            <p className="cx-muted">Select a plan to continue.</p>
          )}

          {lines.length === 0 ? (
            <p className="cx-muted">No products added yet.</p>
          ) : (
            <ul className="cx-summary-lines">
              {lines.map((l) => (
                <li key={l.product.id}>
                  <span>
                    {l.product.name}
                    {l.variant ? ` (${l.variant.value})` : ""} × {l.quantity}
                  </span>
                  <span>{formatMoney(l.amount / 100)}</span>
                </li>
              ))}
            </ul>
          )}

          <dl className="cx-totals">
            <div>
              <dt>Subtotal</dt>
              <dd>{formatMoney(untaxed / 100)}</dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd>{formatMoney(tax / 100)}</dd>
            </div>
            <div className="cx-totals-grand">
              <dt>Estimated total</dt>
              <dd>{formatMoney((untaxed + tax) / 100)}</dd>
            </div>
          </dl>

          {belowMin && <p className="cx-alert cx-alert--error">This plan needs at least {minQty} of each product.</p>}
          {serverError && <p className="cx-alert cx-alert--error">{serverError}</p>}

          <button className="cx-btn cx-btn--primary cx-btn--block" disabled={!canSubmit} onClick={submit}>
            {submitting ? "Sending…" : "Send request"}
          </button>
          <small className="cx-muted">Final prices are confirmed by our team after review.</small>
        </aside>
      </div>
    </>
  );
}