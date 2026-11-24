/**
 * Data-source resolution (server-side, no imports).
 *
 * Switching is one variable: `DATA_SOURCE=local` for the JSON files,
 * `DATA_SOURCE=mongo` for the database.
 *
 *   DATA_SOURCE=auto   local when MONGODB_URL is empty, otherwise mongo
 *   DATA_SOURCE=local  always local files; the Mongo driver is never loaded
 *   DATA_SOURCE=mongo  always Mongo; MONGODB_URL is required
 *
 * Empty DATA_SOURCE is treated as "auto". This is what makes switching a
 * one-variable change and keeps local builds/startups free of Mongo.
 */

export const DATA_SOURCE_MODES = Object.freeze(['auto', 'local', 'mongo']);

export class DataSourceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DataSourceError';
  }
}

export function resolveDataSource(env = process.env) {
  const raw = String(env.DATA_SOURCE || '').trim().toLowerCase();
  const mode = raw || 'auto';
  if (!DATA_SOURCE_MODES.includes(mode)) {
    throw new DataSourceError('DATA_SOURCE must be one of: auto, local, mongo (got "' + raw + '")');
  }
  const hasMongo = Boolean(String(env.MONGODB_URL || '').trim());
  const resolved = mode === 'auto' ? (hasMongo ? 'mongo' : 'local') : mode;
  if (resolved === 'mongo' && !hasMongo) {
    throw new DataSourceError('DATA_SOURCE=mongo requires MONGODB_URL');
  }

  // Fail closed in production: silently writing contracts to a JSON file on the
  // server (or losing them on redeploy) is worse than refusing to start.
  // ALLOW_LOCAL_IN_PRODUCTION=1 is the explicit, documented override for demos.
  const isProd = String(env.NODE_ENV || '').toLowerCase() === 'production';
  const allowLocal = String(env.ALLOW_LOCAL_IN_PRODUCTION || '').trim() === '1';
  if (isProd && resolved === 'local' && !allowLocal) {
    throw new DataSourceError(
      'refusing the local file store in production (DATA_SOURCE=' + mode + ', MONGODB_URL=' + (hasMongo ? 'set' : 'empty') + '). ' +
      'Set MONGODB_URL, or ALLOW_LOCAL_IN_PRODUCTION=1 if this is an intentional demo.'
    );
  }
  return {
    mode,
    resolved,
    hasMongo,
    dbName: String(env.MONGODB_DB || env.MONGODB_DB_NAME || '').trim(),
  };
}

/**
 * Dev-only policy for the remote database.
 *
 * An explicit `DATA_SOURCE=mongo` is a deliberate choice and is honoured —
 * that is the switch. What gets refused is the implicit case: MONGODB_URL is
 * set while DATA_SOURCE is empty or auto, so a dev server would quietly talk
 * to a remote database nobody asked for. Returns the error text, or null.
 */
export function devMongoError(mode, resolved, env = process.env) {
  if (String(env.NODE_ENV || '').toLowerCase() === 'production') return null;
  if (resolved !== 'mongo') return null;
  if (mode === 'mongo') return null;
  if (String(env.ALLOW_REMOTE_DB || '').trim() === '1') return null;
  return (
    '[agreement] refusing to start: MONGODB_URL is set but DATA_SOURCE resolves to "mongo" via "' + mode + '". ' +
    'Set DATA_SOURCE=mongo to use that database, or DATA_SOURCE=local to store contracts in local files.'
  );
}

/** Host + database of the configured Mongo target, with credentials stripped. */
export function describeMongoTarget(env = process.env) {
  const raw = String(env.MONGODB_URL || '').trim();
  const dbName = String(env.MONGODB_DB || env.MONGODB_DB_NAME || '').trim();
  let host = '';
  try {
    host = new URL(raw).host;
  } catch {
    host = raw.replace(/^[a-z+]+:\/\//i, '').replace(/.*@/, '').split(/[/?]/)[0];
  }
  return (host || 'unparsed MONGODB_URL') + (dbName ? ' / ' + dbName : '');
}
