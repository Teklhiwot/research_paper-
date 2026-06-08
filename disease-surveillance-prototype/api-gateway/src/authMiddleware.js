'use strict';

/**
 * authMiddleware.js
 *
 * Express middleware for JWT-based authentication and role-based authorisation.
 *
 * Usage
 *   const { authenticate, requireRole } = require('./src/authMiddleware');
 *
 *   // Authenticate + authorise in one step
 *   app.post('/report', authenticate, requireRole('REPORTER'), handler);
 *
 * Token format
 *   Authorization: Bearer <HS256-signed JWT>
 *
 * Required JWT claims
 *   sub   {string}  – subject / user ID
 *   role  {string}  – one of REPORTER | FOG_NODE | ADMIN
 *
 * Environment variables
 *   JWT_SECRET  – HMAC-SHA256 signing secret (required)
 */

const jwt = require('jsonwebtoken');

// ─── Constants ────────────────────────────────────────────────────────────────

/** All recognised roles. Any token whose `role` claim is not in this set is rejected. */
const VALID_ROLES = new Set(['REPORTER', 'FOG_NODE', 'ADMIN']);

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * authenticate
 *
 * Validates the Bearer JWT in the Authorization header, then attaches the
 * decoded payload to `req.user` as:
 *   {
 *     id:   string   – from JWT `sub` claim
 *     role: string   – 'REPORTER' | 'FOG_NODE' | 'ADMIN'
 *     ...            – any other claims present in the token
 *   }
 *
 * Responses on failure:
 *   401 – missing / malformed Authorization header
 *   401 – token verification failed (expired, wrong signature, …)
 *   403 – token is valid but carries an unrecognised role
 *   500 – JWT_SECRET is not configured (server misconfiguration)
 *
 * @type {import('express').RequestHandler}
 */
function authenticate(req, res, next) {
  // ── 1. Extract Bearer token ───────────────────────────────────────────────
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header required (Bearer token)' });
  }

  const token = authHeader.slice(7); // strip 'Bearer '

  // ── 2. Guard against missing server configuration ─────────────────────────
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[auth] JWT_SECRET environment variable is not set');
    return res.status(500).json({ error: 'Authentication service misconfigured' });
  }

  // ── 3. Verify signature and expiry ────────────────────────────────────────
  let decoded;
  try {
    decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch (err) {
    // Distinguish expired tokens from other failures for better logging
    const reason = err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
    return res.status(401).json({ error: reason });
  }

  // ── 4. Validate role claim ────────────────────────────────────────────────
  if (!decoded.role || !VALID_ROLES.has(decoded.role)) {
    return res.status(403).json({
      error: `Unrecognised role "${decoded.role ?? '(none)'}". Must be one of: ${[...VALID_ROLES].join(', ')}`,
    });
  }

  // ── 5. Attach user context to request ────────────────────────────────────
  // Spread decoded claims first so that our explicit mappings can't be
  // shadowed by a crafted token that includes an 'id' or 'role' claim.
  req.user = {
    ...decoded,
    id:   decoded.sub,    // normalise `sub` → `id` for convenience
    role: decoded.role,
  };

  next();
}

/**
 * requireRole
 *
 * Authorization guard factory.  Returns middleware that allows only callers
 * whose `req.user.role` is in the provided list.  Must be placed AFTER
 * `authenticate` in the middleware chain.
 *
 * @param {...string} roles  One or more allowed role strings
 * @returns {import('express').RequestHandler}
 *
 * @example
 *   app.post('/report', authenticate, requireRole('REPORTER'), handler);
 *   app.get('/admin',   authenticate, requireRole('ADMIN', 'FOG_NODE'), handler);
 */
function requireRole(...roles) {
  if (roles.length === 0) {
    throw new Error('requireRole() must be called with at least one role');
  }

  const allowed = new Set(roles);

  return function roleGuard(req, res, next) {
    // Defensive: authenticate should always run first
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!allowed.has(req.user.role)) {
      return res.status(403).json({
        error: `Role "${req.user.role}" is not permitted to access this endpoint`,
      });
    }

    next();
  };
}

module.exports = { authenticate, requireRole };
