const { allowCors, methodNotAllowed, sendError, sendJson } = require('../_lib/http');
const { hasDatabaseConnection, query } = require('../_lib/db');

function normalizeString(value, maxLength = 4000) {
  return String(value || '').trim().slice(0, maxLength);
}

function hasCronAccess(req) {
  const cronSecret = process.env.CRON_SECRET || '';
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  return Boolean((cronSecret && bearerToken === cronSecret) || req.headers['x-vercel-cron']);
}

function buildNotificationMessage(job) {
  const payload = job.payload && typeof job.payload === 'object' ? job.payload : {};
  const lines = [
    `Case: ${payload.caseReference || payload.caseId || 'Unknown case'}`,
    `Queue: ${payload.queueLabel || job.queueKey || 'Workflow'}`,
    payload.stageLabel ? `Stage: ${payload.stageLabel}` : '',
    payload.taskLabel ? `Task: ${payload.taskLabel}` : '',
    payload.reason ? `Reason: ${payload.reason}` : '',
    payload.nextBestAction ? `Next action: ${payload.nextBestAction}` : ''
  ].filter(Boolean);

  return lines.join('\n');
}

async function claimJobs(limit = 20) {
  const workerName = `cron:${process.env.VERCEL_REGION || 'local'}:${process.pid}`;
  const result = await query(`
    with due_jobs as (
      select id
      from ops_jobs
      where status in ('queued', 'failed')
        and run_at <= now()
        and attempts < max_attempts
      order by run_at asc, created_at asc
      limit $1
      for update skip locked
    )
    update ops_jobs jobs
    set
      status = 'processing',
      attempts = jobs.attempts + 1,
      locked_at = now(),
      locked_by = $2,
      updated_at = now(),
      last_error = ''
    from due_jobs
    where jobs.id = due_jobs.id
    returning
      jobs.id::text as id,
      jobs.case_id::text as case_id,
      jobs.queue_key,
      jobs.job_type,
      jobs.payload,
      jobs.attempts,
      jobs.max_attempts
  `, [limit, workerName]);

  return result.rows;
}

async function completeJob(jobId) {
  await query(`
    update ops_jobs
    set
      status = 'completed',
      completed_at = now(),
      updated_at = now(),
      locked_at = null,
      locked_by = ''
    where id = $1::uuid
  `, [jobId]);
}

async function failJob(jobId, error) {
  await query(`
    update ops_jobs
    set
      status = 'failed',
      last_error = $2,
      updated_at = now(),
      locked_at = null,
      locked_by = ''
    where id = $1::uuid
  `, [jobId, normalizeString(error && error.message ? error.message : error, 2000)]);
}

async function recordSystemNotification(job) {
  const payload = job.payload && typeof job.payload === 'object' ? job.payload : {};
  const subject = job.job_type === 'case_automation_task'
    ? `Case action due: ${payload.taskLabel || payload.caseReference || job.case_id}`
    : `Workflow follow-up due: ${payload.caseReference || job.case_id}`;

  await query(`
    insert into notifications (
      case_id,
      direction,
      channel,
      template_key,
      subject,
      body,
      status,
      metadata,
      sent_at
    ) values (
      nullif($1, '')::uuid,
      'internal',
      'system',
      $2,
      $3,
      $4,
      'sent',
      $5::jsonb,
      now()
    )
  `, [
    job.case_id || '',
    job.job_type,
    subject,
    buildNotificationMessage(job),
    JSON.stringify(payload)
  ]);
}

module.exports = async function handler(req, res) {
  allowCors(res, req);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!['GET', 'POST'].includes(req.method)) {
    methodNotAllowed(res, ['GET', 'POST', 'OPTIONS']);
    return;
  }

  if (!hasDatabaseConnection()) {
    sendError(res, 503, 'Database runtime is not configured.');
    return;
  }

  if (!hasCronAccess(req)) {
    sendError(res, 401, 'Cron access denied.');
    return;
  }

  try {
    const jobs = await claimJobs(20);
    const processed = [];

    for (const job of jobs) {
      try {
        await recordSystemNotification(job);
        await completeJob(job.id);
        processed.push({
          id: job.id,
          type: job.job_type,
          caseId: job.case_id,
          status: 'completed'
        });
      } catch (error) {
        await failJob(job.id, error);
        processed.push({
          id: job.id,
          type: job.job_type,
          caseId: job.case_id,
          status: 'failed',
          error: normalizeString(error && error.message ? error.message : error, 300)
        });
      }
    }

    sendJson(res, 200, {
      ok: true,
      claimed: jobs.length,
      processed
    });
  } catch (error) {
    sendError(res, 500, error.message || 'Could not process scheduled jobs.');
  }
};
