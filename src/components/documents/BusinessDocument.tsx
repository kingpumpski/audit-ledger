import { Building2 } from 'lucide-react';
import { type BusinessDocument as DocumentData, money, documentDate } from '@/lib/business-document';
export function BusinessDocument({ data: d }: { data: DocumentData }) {
  const c = d.company;
  return <article className="business-document" aria-label={`${d.kind} ${d.number}`}>
    <header className="document-header">
      <div className="document-brand">{c?.company_logo_url ? <img className="document-logo" src={c.company_logo_url} alt={c.company_name} /> : <Building2 className="document-logo" />}
        <div><h2>{c?.company_name || 'Company'}</h2><p>{[c?.company_address, c?.company_city, c?.company_country].filter(Boolean).join(', ')}</p><p>{[c?.company_phone, c?.company_email].filter(Boolean).join(' · ')}</p>{c?.company_tax_id && <p>Tax ID: {c.company_tax_id}</p>}</div>
      </div>
      <div className="document-title"><span>{d.kind === 'invoice' ? 'INVOICE' : 'PAYMENT RECEIPT'}</span><strong>{d.number}</strong><small className="capitalize">{d.status.replace('_', ' ')}</small></div>
    </header>
    <section className="document-parties"><div><span className="document-label">{d.kind === 'invoice' ? 'Bill to' : 'Received from'}</span><h3>{d.customer?.name || 'Customer unavailable'}</h3><p>{d.customer?.phone}</p><p>{d.customer?.email}</p><p>{[d.customer?.address_line1, d.customer?.city].filter(Boolean).join(', ')}</p></div>
      <dl><div><dt>Issued</dt><dd>{documentDate(d.date)}</dd></div>{d.dueDate && <div><dt>Due date</dt><dd>{documentDate(d.dueDate)}</dd></div>}{d.invoiceNumber && <div><dt>Invoice reference</dt><dd>{d.invoiceNumber}</dd></div>}{d.paymentMethod && <div><dt>Payment method</dt><dd className="capitalize">{d.paymentMethod.replaceAll('_', ' ')}</dd></div>}</dl>
    </section>
    <div className="document-table-wrap"><table className="document-table"><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>{d.items.map((item, i) => <tr key={i}><td>{item.description}</td><td>{item.quantity}</td><td>{money(item.unit_price, c)}</td><td>{money(item.line_total, c)}</td></tr>)}</tbody></table></div>
    <section className="document-summary"><div className="document-notes">{d.notes && <><span className="document-label">Notes</span><p>{d.notes}</p></>}{d.terms && <><span className="document-label">Terms</span><p>{d.terms}</p></>}</div><dl>
      {d.kind === 'invoice' && <><div><dt>Subtotal</dt><dd>{money(d.subtotal, c)}</dd></div>{d.discount !== 0 && <div><dt>Discount</dt><dd>−{money(d.discount, c)}</dd></div>}{d.tax !== 0 && <div><dt>Tax</dt><dd>{money(d.tax, c)}</dd></div>}<div className="document-total"><dt>Total</dt><dd>{money(d.total, c)}</dd></div><div><dt>Amount paid</dt><dd>{money(d.paid, c)}</dd></div></>}
      <div className="document-highlight"><dt>{d.kind === 'receipt' ? 'Payment received' : 'Balance due'}</dt><dd>{money(d.kind === 'receipt' ? d.total : d.balance, c)}</dd></div>
    </dl></section>
    {d.issuer && <section className="document-signature">{d.signature && <img src={d.signature} alt={`Signature of ${d.issuer}`} />}<strong>{d.issuer}</strong><span>Issued by</span></section>}
    <footer className="document-footer"><p>Thank you for choosing {c?.company_name || 'our company'}.</p><span>{d.number}{d.checksum ? ` · Record checksum: ${d.checksum}` : ''}</span></footer>
  </article>;
}