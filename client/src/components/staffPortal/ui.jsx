import { useCallback, useEffect, useState } from 'react';

export const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n || 0));

export const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

// yyyy-mm-dd for <input type="date"> and the API
export const ymd = (d) => {
  const x = d ? new Date(d) : new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
};

export function useLoad(fn, deps) {
  const [s, setS] = useState({ data: null, error: '', loading: true });
  const run = useCallback(() => {
    setS((p) => ({ ...p, loading: true, error: '' }));
    fn().then((data) => setS({ data, error: '', loading: false }))
        .catch((e) => setS({ data: null, error: e.message, loading: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...s, reload: run };
}

export const Status = ({ value }) => (
  <span className={`sp-badge sp-b-${value}`}>{String(value).replace('_', ' ')}</span>
);

export function PageHead({ title, children }) {
  return (
    <div className="sp-page-head">
      <h1>{title}</h1>
      <div className="sp-actions sp-no-print">{children}</div>
    </div>
  );
}

export const Notice = ({ error, loading }) =>
  loading ? <p className="sp-muted">Loading…</p> : error ? <p className="sp-err">{error}</p> : null;

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="sp-overlay" onMouseDown={onClose}>
      <div className="sp-modal" role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

// One-field dialog for "reason" / "new date" style actions
export function PromptModal({ title, label, type = 'text', initial = '', cta, onSubmit, onClose }) {
  const [v, setV] = useState(initial);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await onSubmit(v); } catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={go}>
        <label>{label}<input type={type} value={v} onChange={(e) => setV(e.target.value)} required autoFocus /></label>
        {err && <p className="sp-err">{err}</p>}
        <div className="sp-row-end">
          <button type="button" className="sp-btn sp-ghost" onClick={onClose}>Cancel</button>
          <button className="sp-btn" disabled={busy}>{cta}</button>
        </div>
      </form>
    </Modal>
  );
}

export function Pager({ page, pages, onChange }) {
  if (pages <= 1) return null;
  return (
    <div className="sp-pager sp-no-print">
      <button className="sp-btn sp-ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
      <span className="sp-muted">Page {page} of {pages}</span>
      <button className="sp-btn sp-ghost" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
    </div>
  );
}