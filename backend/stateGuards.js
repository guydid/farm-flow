// ─── State guards for the generic CRUD (/api/:entity) and MCP create/update_record ───
// Several entities carry a server-owned state machine (lease payments/invoices, orders and
// delivery notes, invoice "sent" state, Maven documents). Their transitions live in dedicated
// routes; the generic write paths must not be able to jump states or orphan linked records.
// Each hook returns the (possibly adjusted) data, or throws GuardError(status, message).

class GuardError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function makeStateGuards({ procurement, NOW }) {
  const PROCUREMENT = new Set(['orders', 'order_items', 'delivery_notes', 'delivery_note_items']);
  const LOCKED = new Set(['lease_invoices']);           // only via /api/leases/:id/invoice, /api/lease-invoices/:id/*
  const ADMIN_ONLY = new Set(['subscriptions', 'payments']); // plan state is farm.plan, set by the admin
  const LP_MANAGED = ['paid_date', 'paid_amount', 'paid_by', 'invoice_id', 'invoice_no', 'meter_reading_id'];
  const LP_FREE = new Set(['due', 'overdue', 'cancelled']);
  const SENT_FIELDS = ['sent_to_bookkeeper_at', 'sent_to', 'sent_via', 'sent_manually', 'sent_marked_by'];
  const today = () => NOW().slice(0, 10);
  const keep = (target, source, fields) => { for (const k of fields) { if (k in source) target[k] = source[k]; else delete target[k]; } };

  function common(entity, { isAdmin, via }) {
    if (ADMIN_ONLY.has(entity) && !isAdmin) throw new GuardError(403, 'מצב המנוי נקבע ע"י מנהל המערכת');
    if (LOCKED.has(entity)) throw new GuardError(400, 'חשבוניות שכירות מופקות, משולמות ומבוטלות רק ממסך השכירויות');
    if (PROCUREMENT.has(entity) && via === 'rest') throw new GuardError(400, 'הזמנות ותעודות משלוח מתעדכנות דרך /api/procurement');
  }

  // invoice.status 'sent' ⇔ sent_to_bookkeeper_at is set
  function syncInvoiceSent(data, by) {
    if (data.status === 'sent' && !data.sent_to_bookkeeper_at) {
      Object.assign(data, { sent_to_bookkeeper_at: NOW(), sent_to: 'סומן ידנית', sent_via: 'other', sent_manually: true, sent_marked_by: by || null });
    } else if (data.status !== 'sent' && data.sent_to_bookkeeper_at && data._was_sent) {
      SENT_FIELDS.forEach(k => delete data[k]);
    }
    delete data._was_sent;
    return data;
  }

  function onCreate(entity, data, opts) {
    common(entity, opts);
    const d = { ...data };
    if (entity === 'lease_payments') {
      LP_MANAGED.forEach(k => delete d[k]);
      if (!LP_FREE.has(d.status)) d.status = d.due_date && d.due_date < today() ? 'overdue' : 'due';
    } else if (entity === 'weighing_certificates') {
      delete d.maven_documents;
    } else if (entity === 'invoices') {
      delete d.delivery_note_ids;
      if (d.status !== 'sent') SENT_FIELDS.forEach(k => delete d[k]);
      syncInvoiceSent(d, opts.by);
    }
    return d;
  }

  // `updated` is the merged record ({...existing, ...incoming}); `existing` is what is stored.
  function onUpdate(entity, existing, updated, opts) {
    common(entity, opts);
    const d = { ...updated };
    if (entity === 'lease_payments') {
      keep(d, existing, LP_MANAGED);
      if (d.status !== existing.status) {
        if (!LP_FREE.has(existing.status) || !LP_FREE.has(d.status) || existing.invoice_id) {
          throw new GuardError(400, 'סימון תשלום / ביטול חיוב שבחשבונית — דרך כפתורי התשלום בהסכם');
        }
      }
    } else if (entity === 'leases') {
      // קריאת מונה שנרשמה אחרי פתיחת הטופס לא נדרסת ע"י העותק הישן שבטופס
      const prev = Array.isArray(existing.meters) ? existing.meters : [];
      if (Array.isArray(d.meters)) {
        d.meters = d.meters.map(m => {
          const old = prev.find(p => p && m && p.type === m.type);
          if (old && old.last_reading_date && String(m.last_reading_date || '') < String(old.last_reading_date)) {
            return { ...m, last_reading: old.last_reading, last_reading_date: old.last_reading_date };
          }
          return m;
        });
      }
    } else if (entity === 'invoices') {
      keep(d, existing, [...SENT_FIELDS, 'delivery_note_ids']);
      d._was_sent = existing.status === 'sent';
      syncInvoiceSent(d, opts.by);
    } else if (entity === 'weighing_certificates') {
      keep(d, existing, ['maven_documents']);
    } else if (entity === 'seedings') {
      if (d.status !== existing.status) { delete d.status_auto; delete d.status_before_auto; } // שינוי ידני גובר על הנגזר
    }
    return d;
  }

  // Returns true when the hook already deleted the record (cascade handled here).
  function onDelete(entity, row, data, opts) {
    common(entity, { ...opts, via: 'delete' });
    if (entity === 'lease_payments' && data.invoice_id) {
      throw new GuardError(400, `החיוב כלול בחשבונית ${data.invoice_no || ''} — בטל את החשבונית קודם`.replace('  ', ' '));
    }
    if (entity === 'order_items' || entity === 'delivery_note_items') {
      throw new GuardError(400, 'שורות הזמנה / תעודה נערכות מתוך ההזמנה או התעודה');
    }
    if (!procurement || !row.farm_id) return false;
    if (entity === 'delivery_notes') return procurement.deleteDeliveryNote(row.farm_id, opts.by, row.id);
    if (entity === 'orders') return procurement.deleteOrder(row.farm_id, opts.by, row.id);
    if (entity === 'invoices') procurement.unlinkInvoice(row.farm_id, opts.by, row.id);
    return false;
  }

  return { onCreate, onUpdate, onDelete, GuardError };
}

module.exports = { makeStateGuards, GuardError };
