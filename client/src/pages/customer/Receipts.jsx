import { Link, useSearchParams } from "react-router-dom";
import { customerApi } from "../../services/customerApi";
import { useAsync } from "../../components/customer/useAsync";
import { formatDate, formatMoney, titleCase } from "../../components/customer/format";
import { PageHeader, Loading, ErrorBox, EmptyState, Pagination } from "../../components/customer/common";

export default function Receipts() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page")) || 1;
  const { loading, error, data } = useAsync(() => customerApi.receipts({ page, limit: 10 }), [page]);

  return (
    <>
      <PageHeader title="Receipts" subtitle="Proof of every payment you have made." />

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No receipts yet" text="A receipt is issued as soon as a payment is recorded." />
      ) : (
        <>
          <div className="cx-tablewrap">
            <table className="cx-table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Invoice</th>
                  <th>Date</th>
                  <th>Method</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td><Link to={`/customer/receipts/${r.id}`}>{r.receipt_number}</Link></td>
                    <td><Link to={`/customer/invoices/${r.invoice_id}`}>{r.invoice_number}</Link></td>
                    <td>{formatDate(r.payment_date)}</td>
                    <td>{titleCase(r.method)}</td>
                    <td className="num">{formatMoney(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={(p) => setParams(p > 1 ? { page: p } : {})} />
        </>
      )}
    </>
  );
}