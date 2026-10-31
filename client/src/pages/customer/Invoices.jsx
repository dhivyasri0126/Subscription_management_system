import { Link, useSearchParams } from "react-router-dom";
import { customerApi } from "../../services/customerApi";
import { useAsync } from "../../components/customer/useAsync";
import { formatDate, formatMoney } from "../../components/customer/format";
import { PageHeader, Loading, ErrorBox, EmptyState, InvoiceBadge, Tabs, Pagination } from "../../components/customer/common";

const TABS = [
  { value: "", label: "All" },
  { value: "confirmed", label: "Unpaid" },
  { value: "paid", label: "Paid" },
];

export default function Invoices() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") || "";
  const page = Number(params.get("page")) || 1;

  const { loading, error, data } = useAsync(() => customerApi.invoices({ status, page, limit: 10 }), [status, page]);

  const update = (next) => {
    const merged = { status, page, ...next };
    const p = {};
    if (merged.status) p.status = merged.status;
    if (merged.page > 1) p.page = merged.page;
    setParams(p);
  };

  return (
    <>
      <PageHeader title="Invoices" subtitle="Bills for your subscriptions." />
      <Tabs tabs={TABS} value={status} onChange={(v) => update({ status: v, page: 1 })} />

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No invoices" text="Invoices appear here once they are issued." />
      ) : (
        <>
          <div className="cx-tablewrap">
            <table className="cx-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Subscription</th>
                  <th>Date</th>
                  <th>Due</th>
                  <th className="num">Total</th>
                  <th className="num">Balance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((i) => (
                  <tr key={i.id}>
                    <td><Link to={`/customer/invoices/${i.id}`}>{i.invoice_number}</Link></td>
                    <td>{i.subscription_number}</td>
                    <td>{formatDate(i.invoice_date)}</td>
                    <td>{formatDate(i.due_date)}</td>
                    <td className="num">{formatMoney(i.total_amount)}</td>
                    <td className="num">{formatMoney(i.balance_due)}</td>
                    <td><InvoiceBadge invoice={i} /></td>
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