const { allowCors, methodNotAllowed, parseJsonBody, sendError, sendJson } = require('./_lib/http');
const { hasDatabaseConnection, query } = require('./_lib/db');
const { requireAdminAccess } = require('./_lib/security');
const { listPartnerAccounts } = require('./_lib/store');

function normalizeString(value, maxLength = 2000) {
  return String(value || '').trim().slice(0, maxLength);
}

async function savePartnerLead(body) {
  const businessName = normalizeString(body.businessName, 180);
  const primaryContactName = normalizeString(body.primaryContactName, 180);
  const email = normalizeString(body.email, 180);
  const phone = normalizeString(body.phone, 80);
  const notes = normalizeString(body.notes, 4000);
  const partnerType = normalizeString(body.partnerType, 40) || 'funeral_director';
  const area = normalizeString(body.area, 180);

  if (!businessName || !primaryContactName || !email) {
    return {
      ok: false,
      statusCode: 400,
      message: 'Business name, contact name, and email are required.'
    };
  }

  const existing = await query(`
    select id::text as id
    from partner_accounts
    where lower(business_name) = lower($1)
       or (email <> '' and lower(email) = lower($2))
    order by created_at asc
    limit 1
  `, [businessName, email]);

  const mergedNotes = [area ? `Area: ${area}` : '', notes].filter(Boolean).join('\n');
  let partnerId = '';

  if (existing.rows[0] && existing.rows[0].id) {
    partnerId = existing.rows[0].id;

    await query(`
      update partner_accounts
      set
        partner_type = $2,
        business_name = $3,
        primary_contact_name = $4,
        email = $5,
        phone = $6,
        status = 'prospect',
        notes = $7,
        updated_at = now()
      where id = $1::uuid
    `, [
      partnerId,
      partnerType,
      businessName,
      primaryContactName,
      email,
      phone,
      mergedNotes
    ]);
  } else {
    const inserted = await query(`
      insert into partner_accounts (
        partner_type,
        business_name,
        primary_contact_name,
        email,
        phone,
        status,
        notes
      ) values ($1, $2, $3, $4, $5, 'prospect', $6)
      returning id::text as id
    `, [
      partnerType,
      businessName,
      primaryContactName,
      email,
      phone,
      mergedNotes
    ]);

    partnerId = inserted.rows[0] && inserted.rows[0].id;
  }

  return {
    ok: true,
    statusCode: 201,
    partnerLead: {
      id: partnerId,
      businessName,
      primaryContactName,
      email
    }
  };
}

module.exports = async function handler(req, res) {
  allowCors(res, req);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!hasDatabaseConnection()) {
    sendError(res, 503, 'Partner storage is not configured yet.');
    return;
  }

  try {
    if (req.method === 'POST') {
      const body = await parseJsonBody(req);
      const result = await savePartnerLead(body);

      if (!result.ok) {
        sendError(res, result.statusCode, result.message);
        return;
      }

      sendJson(res, result.statusCode, {
        ok: true,
        partnerLead: result.partnerLead
      });
      return;
    }

    if (req.method === 'GET') {
      const adminCheck = await requireAdminAccess(req, 'dashboard.view');

      if (!adminCheck.ok) {
        sendError(res, adminCheck.statusCode, adminCheck.message);
        return;
      }

      const partners = await listPartnerAccounts();
      sendJson(res, 200, {
        ok: true,
        partners
      });
      return;
    }

    methodNotAllowed(res, ['GET', 'POST', 'OPTIONS']);
  } catch (error) {
    sendError(res, 500, error.message || 'We could not process the partner request.');
  }
};
