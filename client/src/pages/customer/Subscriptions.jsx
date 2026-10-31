import { Link, useSearchParams } from "react-router-dom";
import { customerApi } from "../../services/customerApi";
import { useAsync } from "../../components/customer/useAsync";
import { formatDate, formatMoney, periodLabel } from "../../components/customer/format";
import { PageHeader, Loading, ErrorBox, EmptyState, StatusBadge, Tabs, Pagination } from "../../components/customer/common";

const TABS = [
  { value: "", label: "All" },
  { value: "quotation", label: "Quotations" },
  { value: "confirmed", label: "Confirmed" },
  { value: "active", label: "Active" },
  { value: "closed", label: "Closed" },
];

function whenText(s) {
  if (s.status === "quotation") return `Valid until ${formatDate(s.quotation_valid_until)}`;
  if (s.status === "active") return `Next billing ${formatDate(s.next_billing_date)}`;
  if (s.status === "closed") return `Ended ${formatDate(s.expiry_date)}`;
  return `Requested ${formatDate(s.created_at)}`;
}

export default function Subscriptions() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") || "";
  const page = Number(params.get("page")) || 1;

  const { loading, error, data } = useAsync(() => customerApi.subscriptions({ status, page, limit: 10 }), [status, page]);

  const update = (next) => {
    const merged = { status, page, ...next };
    const p = {};
    if (merged.status) p.status = merged.status;
    if (merged.page > 1) p.page = merged.page;
    setParams(p);
  };

  return (
    <>
      <PageHeader
        title="Subscriptions"
        subtitle="Your quotations and subscriptions."
        actions={
          <Link className="cx-btn cx-btn--primary" to="/customer/request">
            New request
          </Link>
        }
      />
      <Tabs tabs={TABS} value={status} onChange={(v) => update({ status: v, page: 1 })} />

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} />
      ) : data.items.length === 0 ? (
        <EmptyState title="Nothing here yet" text="Request a quotation to start a subscription." actionTo="/customer/request" actionLabel="Request a quotation" />
      ) : (
        <>
          <div className="cx-tablewrap">
            <table className="cx-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link to={`/customer/subscriptions/${s.id}`}>{s.subscription_number}</Link>
                    </td>
                    <td>
                      {s.plan_name} <small className="cx-muted">/ {periodLabel(s.billing_period)}</small>
                    </td>
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
                    <td>{whenText(s)}</td>
                    <td className="num">{formatMoney(s.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={(p) => update({ page: p })} />
        </>
      )}
    </>
  );
}