require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const csrf = require('csurf');
const helmet = require('helmet');
const { body, query, param, validationResult } = require('express-validator');
const crypto = require('crypto');
const Encryption = require('./encryption');
const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Trust proxy for accurate IP detection (important for Fly.io and other proxies)
app.set('trust proxy', true);
const db = require('./database');
const quickbooks = require('./quickbooks');
const ReceiptGenerator = require('./receipt-generator');
const TemplateManager = require('./template-manager');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Initialize receipt generator and template manager
const receiptGenerator = new ReceiptGenerator();
const templateManager = new TemplateManager();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Check file type
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Global email transporter (will be initialized and updated as needed)
let emailTransporter = null;

// Utility: mask secrets (show only last 2 chars)
function maskSecret(secret) {
  if (!secret) return '(none)';
  const s = String(secret);
  if (s.length <= 2) return '*'.repeat(s.length);
  return '*'.repeat(s.length - 2) + s.slice(-2);
}

function logEmailConfig(source, cfg) {
  try {
    const passInfo = cfg && cfg.pass ? `${maskSecret(cfg.pass)} (len=${String(cfg.pass).length})` : '(none)';
    console.log('📧 Email config:', {
      source,
      host: cfg && cfg.host,
      port: cfg && cfg.port,
      secure: !!(cfg && cfg.secure),
      user: cfg && cfg.user,
      password: passInfo
    });
  } catch (e) {
    // Never let logging break the app
  }
}

// Initialize email transporter on startup (from environment variables)
function initializeEmailTransporter() {
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    const cfg = {
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.EMAIL_PORT) || 587,
      secure: process.env.EMAIL_SECURE === 'true' || false,
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    };

    // Log masked config
    logEmailConfig('ENV(startup)', cfg);

    emailTransporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: {
        user: cfg.user,
        pass: cfg.pass
      }
    });

    // Verify transporter configuration on startup
    emailTransporter.verify((error, success) => {
      if (error) {
        console.log('⚠️  Email transporter verification failed:', error.message);
      } else {
        console.log('✅ Email transporter ready');
      }
    });
  } else {
    console.log('ℹ️  Email transporter not initialized (no EMAIL_USER/EMAIL_PASS in environment)');
  }
}

// Initialize on startup
initializeEmailTransporter();

// Secure database file permissions on startup
(function hardenDatabasePermissions(){
  try {
    const dataDir = path.join(__dirname, 'data');
    const dbFile = path.join(dataDir, 'data.db');
    const walFile = path.join(dataDir, 'data.db-wal');
    const shmFile = path.join(dataDir, 'data.db-shm');

    // Ensure data directory exists and set to 700
    try {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
        console.log('🔐 Created data directory with 700 permissions');
      }
      // Attempt to enforce 700 on existing dir
      fs.chmodSync(dataDir, 0o700);
    } catch (e) {
      console.warn('⚠️  Could not set permissions on data directory:', e.message);
    }

    // Helper to chmod file if exists
    const protectFile = (p) => {
      try {
        if (fs.existsSync(p)) {
          fs.chmodSync(p, 0o600);
          console.log(`🔐 Set 600 permissions on ${path.basename(p)}`);
        }
      } catch (e) {
        console.warn(`⚠️  Could not set 600 permissions on ${path.basename(p)}:`, e.message);
      }
    };

    protectFile(dbFile);
    protectFile(walFile);
    protectFile(shmFile);
  } catch (err) {
    console.warn('⚠️  Database permission hardening skipped:', err.message);
  }
})();

// Set EJS as template engine
app.set('view engine', 'ejs');
app.set('views', './views');

// XSS Protection: Add security headers with Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      scriptSrcAttr: ["'unsafe-inline'"], // Allow inline event handlers (onclick, etc.)
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
      connectSrc: ["'self'"],
      frameSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false, // Allow PDF iframes
  xssFilter: true, // Enable XSS filter
  noSniff: true, // Prevent MIME type sniffing
  frameguard: { action: 'sameorigin' } // Allow same-origin frames (for PDF viewer)
}));

// SQL Injection Protection: Detect and block SQL injection attempts
function detectSQLInjection(input) {
  if (typeof input !== 'string') {
    return false;
  }
  
  // Common SQL injection patterns
  const sqlInjectionPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|SCRIPT)\b)/i,
    /('|(\\')|(;)|(--)|(\/\*)|(\*\/)|(\+)|(\%27)|(\%22))/i,
    /(\bOR\b.*=.*)|(\bAND\b.*=.*)/i,
    /(\bUNION\b.*\bSELECT\b)/i,
    /(\bEXEC\b|\bEXECUTE\b)/i,
    /(\bCHAR\b|\bCONCAT\b)/i,
    /(\bWAITFOR\b.*\bDELAY\b)/i,
    /(\bBENCHMARK\b)/i,
    /(\bLOAD_FILE\b)/i,
    /(\bINTO\b.*\bOUTFILE\b)/i,
    /(\bINTO\b.*\bDUMPFILE\b)/i
  ];
  
  return sqlInjectionPatterns.some(pattern => pattern.test(input));
}

// SQL Injection Protection: Validate SQL-safe identifier (for table/column names)
function validateSQLIdentifier(identifier) {
  if (typeof identifier !== 'string') {
    return false;
  }
  
  // Only allow alphanumeric, underscore, and must start with letter or underscore
  // This prevents SQL injection via table/column name manipulation
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier) && identifier.length <= 64;
}

// XSS Protection: Input sanitization middleware
function sanitizeInput(obj) {
  if (typeof obj === 'string') {
    // Check for SQL injection first
    if (detectSQLInjection(obj)) {
      console.warn('⚠️  Potential SQL injection attempt detected:', obj.substring(0, 100));
      // Don't block, but log - parameterized queries should still protect
      // But we'll sanitize dangerous characters
    }
    
    // Remove script tags and dangerous HTML
    return obj
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .replace(/<iframe/gi, '&lt;iframe')
      .replace(/<object/gi, '&lt;object')
      .replace(/<embed/gi, '&lt;embed');
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeInput(item));
  }
  if (obj && typeof obj === 'object') {
    const sanitized = {};
    for (const key in obj) {
      sanitized[key] = sanitizeInput(obj[key]);
    }
    return sanitized;
  }
  return obj;
}

// SQL Injection Protection: Check all inputs for SQL injection attempts
app.use((req, res, next) => {
  const checkForSQLInjection = (obj, path = '') => {
    if (typeof obj === 'string') {
      if (detectSQLInjection(obj)) {
        console.warn(`⚠️  SQL Injection attempt detected in ${path}:`, obj.substring(0, 100));
        // Log but don't block - parameterized queries should protect
        // In production, you might want to block or rate limit
      }
    } else if (Array.isArray(obj)) {
      obj.forEach((item, index) => checkForSQLInjection(item, `${path}[${index}]`));
    } else if (obj && typeof obj === 'object') {
      for (const key in obj) {
        checkForSQLInjection(obj[key], path ? `${path}.${key}` : key);
      }
    }
  };
  
  if (req.body) {
    checkForSQLInjection(req.body, 'body');
    req.body = sanitizeInput(req.body);
  }
  if (req.query) {
    checkForSQLInjection(req.query, 'query');
    req.query = sanitizeInput(req.query);
  }
  if (req.params) {
    checkForSQLInjection(req.params, 'params');
    req.params = sanitizeInput(req.params);
  }
  next();
});

// Middleware to parse JSON bodies with increased limit for logo uploads
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Beta access: if BETA_REQUIRED and user has quickbooks_realmId cookie, ensure realm is allowed (used an invite code)
app.use(async (req, res, next) => {
  if (!BETA_REQUIRED) return next();
  const realmId = req.cookies && req.cookies.quickbooks_realmId;
  if (!realmId) return next();
  const skipPaths = ['/auth/quickbooks/callback', '/api/beta/submit', '/api/beta/invite-codes'];
  if (skipPaths.some(p => req.path === p || req.path.startsWith(p))) return next();
  try {
    const allowed = await db.isRealmAllowed(realmId);
    if (allowed) return next();
  } catch (e) {
    return next(e);
  }
  res.clearCookie('quickbooks_realmId', { httpOnly: true, sameSite: 'lax', secure: IS_PRODUCTION });
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(403).json({ error: 'Beta access required', message: 'Your invite is no longer valid. Please use a new invite code.', betaRequired: true });
  }
  return res.redirect('/?beta=1');
});

// Restrict HTTP methods - only allow GET, POST, PUT, DELETE, OPTIONS
// Block TRACE and other unused methods for security
app.use((req, res, next) => {
  const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'];
  const method = req.method.toUpperCase();
  
  if (!allowedMethods.includes(method)) {
    // Specifically block TRACE method (security risk)
    if (method === 'TRACE') {
      return res.status(405).json({ 
        error: 'Method Not Allowed',
        message: 'TRACE method is not allowed for security reasons'
      });
    }
    // Block other unused methods
    return res.status(405).json({ 
      error: 'Method Not Allowed',
      message: `HTTP method ${method} is not allowed`
    });
  }
  next();
});

// Disable caching on all SSL/HTTPS pages
app.use((req, res, next) => {
  // Check if request is over HTTPS/SSL (handles both direct HTTPS and proxied requests)
  const isSecure = req.secure || req.protocol === 'https' || req.get('X-Forwarded-Proto') === 'https';
  
  if (isSecure) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

// Serve static files from public directory
app.use(express.static('public'));

const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION
  }
});

app.use(csrfProtection);

app.use((req, res, next) => {
  if (typeof req.csrfToken === 'function') {
    try {
      const token = req.csrfToken();
      res.locals.csrfToken = token;
      res.cookie('XSRF-TOKEN', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: IS_PRODUCTION
      });
    } catch (error) {
      return next(error);
    }
  }
  next();
});

// ===== ADMIN CONFIGURATION =====
const ADMIN_COOKIE_NAME = 'admin_session';
const ADMIN_DEFAULT_PASSWORD = 'Quisha';

// Session management with expiration and security
const adminSessions = new Map(); // Store session data with timestamps
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes of inactivity
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes lockout
const loginAttempts = new Map(); // Track failed login attempts by IP

async function getAdminPasswordOption() {
  try {
    return await db.getOption(null, 'ADMIN_PASS');
  } catch (error) {
    console.error('❌ Error retrieving ADMIN_PASS option:', error);
    return null;
  }
}

async function ensureAdminPassword() {
  let option = await getAdminPasswordOption();
  
  if (!option || !option.value) {
    const encryptedDefault = Encryption.encrypt(ADMIN_DEFAULT_PASSWORD);
    await db.setOption(null, 'ADMIN_PASS', encryptedDefault);
    return encryptedDefault;
  }
  
  if (!Encryption.isEncrypted(option.value)) {
    const encryptedValue = Encryption.encrypt(option.value);
    await db.setOption(option.organizationId ?? null, 'ADMIN_PASS', encryptedValue);
    return encryptedValue;
  }
  
  return option.value;
}

async function getDecryptedAdminPassword() {
  try {
    const encrypted = await ensureAdminPassword();
    const decrypted = Encryption.decrypt(encrypted);
    return decrypted || ADMIN_DEFAULT_PASSWORD;
  } catch (error) {
    console.warn('⚠️  Falling back to default admin password due to decryption issue:', error.message);
    return ADMIN_DEFAULT_PASSWORD;
  }
}

async function verifyAdminPassword(password) {
  if (!password) return false;
  const storedPassword = await getDecryptedAdminPassword();
  return storedPassword === password;
}

function generateAdminSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createAdminSession(res, req) {
  const token = generateAdminSessionToken();
  const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
  
  // Store session with timestamp and client info
  adminSessions.set(token, {
    createdAt: Date.now(),
    lastActivity: Date.now(),
    clientIp: clientIp
  });
  
  // Clear failed login attempts on successful login
  loginAttempts.delete(clientIp);
  
  res.cookie(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    maxAge: SESSION_TIMEOUT // Session expires after inactivity
  });
  return token;
}

function getAdminSessionToken(req) {
  return req.cookies ? req.cookies[ADMIN_COOKIE_NAME] : null;
}

function isAdminAuthenticated(req) {
  const token = getAdminSessionToken(req);
  if (!token) return false;
  
  const session = adminSessions.get(token);
  if (!session) return false;
  
  // Check if session has expired due to inactivity
  const now = Date.now();
  const timeSinceLastActivity = now - session.lastActivity;
  
  if (timeSinceLastActivity > SESSION_TIMEOUT) {
    // Session expired - remove it
    adminSessions.delete(token);
    return false;
  }
  
  // Update last activity timestamp
  session.lastActivity = now;
  return true;
}

function clearAdminSession(req, res) {
  const token = getAdminSessionToken(req);
  if (token) {
    adminSessions.delete(token);
  }
  res.clearCookie(ADMIN_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION
  });
}

// Check if IP is locked out due to too many failed login attempts
function isIpLockedOut(clientIp) {
  const attempts = loginAttempts.get(clientIp);
  if (!attempts) return false;
  
  const timeSinceFirstAttempt = Date.now() - attempts.firstAttempt;
  
  // If lockout period has passed, clear the attempts
  if (timeSinceFirstAttempt > LOCKOUT_DURATION) {
    loginAttempts.delete(clientIp);
    return false;
  }
  
  // Check if max attempts reached
  return attempts.count >= MAX_LOGIN_ATTEMPTS;
}

// Record a failed login attempt
function recordFailedLoginAttempt(clientIp) {
  const attempts = loginAttempts.get(clientIp) || { count: 0, firstAttempt: Date.now() };
  attempts.count++;
  attempts.lastAttempt = Date.now();
  loginAttempts.set(clientIp, attempts);
}

// Clean up expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of adminSessions.entries()) {
    if (now - session.lastActivity > SESSION_TIMEOUT) {
      adminSessions.delete(token);
    }
  }
}, 5 * 60 * 1000); // Clean up every 5 minutes

function requireAdminAuth(req, res, next) {
  if (!isAdminAuthenticated(req)) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  next();
}

async function getAdminData() {
  const [companies, donors, transactionsRaw] = await Promise.all([
    db.getAllOrganizations(),
    db.getAllDonors(),
    db.getAllTransactions()
  ]);

  const companyNameById = new Map();
  companies.forEach(company => {
    if (company && typeof company.id !== 'undefined') {
      companyNameById.set(company.id, company.name || null);
    }
  });
  
  const donorsWithOrganization = donors.map(donor => {
    const organizationName = donor.organizationId ? companyNameById.get(donor.organizationId) : null;
    return {
      ...donor,
      organizationName: organizationName || null
    };
  });
  
  const transactionMap = new Map();
  transactionsRaw.forEach(row => {
    if (!transactionMap.has(row.id)) {
      transactionMap.set(row.id, {
        id: row.id,
        date: row.date,
        amount: row.transaction_total,
        donor_name: row.donor_name || '—',
        donor_email: row.donor_email || '—',
        qb_docnum: row.qb_docnum || '—',
        organizationId: row.organizationId || null,
        organizationName: row.organizationId ? companyNameById.get(row.organizationId) || '—' : '—'
      });
    }
  });
  
  const betaInviteCodes = await db.getAllBetaInviteCodes();
  return {
    companies,
    donors: donorsWithOrganization,
    transactions: Array.from(transactionMap.values()),
    betaInviteCodes
  };
}

ensureAdminPassword().catch(error => {
  console.error('⚠️  Unable to initialize admin password:', error);
});

// ===== AUTHENTICATION MIDDLEWARE =====

// List of public endpoints that don't require QuickBooks authentication
const PUBLIC_ENDPOINTS = [
  '/', // Main page (handles its own logic)
  '/template', // Template manager page
  '/auth/quickbooks', // QuickBooks OAuth initiation
  '/auth/quickbooks/callback', // QuickBooks OAuth callback
  '/receipts/', // Receipt viewing (may need org-specific checks later)
];

// Beta access: when true, only users with a valid invite code (bound to realm after OAuth) can use the app
const BETA_REQUIRED = process.env.BETA_REQUIRED !== 'false';

// List of public API endpoints (work before QuickBooks login)
const PUBLIC_API_ENDPOINTS = [
  '/api/quickbooks/status', // Status check (needed for login flow)
  '/api/beta/submit',       // Submit invite code before OAuth
  '/api/beta/invite-codes', // Create invite codes (admin only via BETA_ADMIN_SECRET)
];

// List of public API endpoint patterns (with parameter matching)
const PUBLIC_API_PATTERNS = [
  {
    pattern: '/api/options/:key',
    publicKeys: ['ShowOpeningScreen', 'showtermsofservice'] // These specific option keys are public
  }
];

/**
 * Middleware to check if an endpoint is public
 */
function isPublicEndpoint(req, publicEndpoints, publicPatterns) {
  const path = req.path;
  
  // Check exact match
  if (publicEndpoints.includes(path)) {
    return true;
  }
  
  // Check pattern matches (for routes with parameters)
  for (const pattern of publicPatterns) {
    const patternParts = pattern.pattern.split('/');
    const pathParts = path.split('/');
    
    if (patternParts.length !== pathParts.length) {
      continue;
    }
    
    // Check if pattern matches (ignoring parameter parts)
    let matches = true;
    const params = {};
    
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        // This is a parameter - store it
        const paramName = patternParts[i].substring(1);
        params[paramName] = pathParts[i];
      } else if (patternParts[i] !== pathParts[i]) {
        matches = false;
        break;
      }
    }
    
    if (matches) {
      // Check if the parameter values are in the public list
      if (pattern.publicKeys) {
        for (const [key, value] of Object.entries(params)) {
          if (pattern.publicKeys.includes(value)) {
            return true;
          }
        }
      } else {
        // No publicKeys restriction - all values are public
        return true;
      }
    }
  }
  
  // Check prefix match for routes like /receipts/:id
  const prefixEndpoints = ['/receipts/'];
  for (const endpoint of prefixEndpoints) {
    if (endpoint.endsWith('/') && path.startsWith(endpoint)) {
      return true;
    }
  }
  
  return false;
}

// ===== OPTIONS API ROUTES (PUBLIC OR CONDITIONAL AUTH) =====

// Get option by key
app.get('/api/options/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const realmId = req.cookies.quickbooks_realmId;
    
    // List of options that don't require QuickBooks connection (browser-based)
    const globalOptions = ['ShowOpeningScreen', 'showtermsofservice'];
    
    // Check if realmId is required for this option
    const requiresQuickbooks = !globalOptions.includes(key);
    
    if (requiresQuickbooks && !realmId) {
      return res.status(400).json({ error: 'No QuickBooks connection found' });
    }
    
    // For global options without QuickBooks, use null organizationId
    let organizationId = null;
    if (realmId) {
      const organization = await db.getOrganizationByQbId(realmId);
      if (!organization) {
        // For global options, allow proceeding without organization
        if (requiresQuickbooks) {
          return res.status(404).json({ error: 'Organization not found' });
        }
      } else {
        organizationId = organization.id;
      }
    }
    
    const option = await db.getOption(organizationId, key);
    
    if (option) {
      res.json(option);
    } else {
      res.status(404).json({ error: 'Option not found' });
    }
  } catch (error) {
    console.error('Error fetching option:', error);
    res.status(500).json({ error: 'Failed to fetch option' });
  }
});

// Set/update option
app.post('/api/options/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;
    const realmId = req.cookies.quickbooks_realmId;
    
    // List of options that don't require QuickBooks connection (browser-based)
    const globalOptions = ['ShowOpeningScreen', 'showtermsofservice'];
    
    // Check if realmId is required for this option
    const requiresQuickbooks = !globalOptions.includes(key);
    
    if (requiresQuickbooks && !realmId) {
      return res.status(400).json({ error: 'No QuickBooks connection found' });
    }
    
    if (value === undefined) {
      return res.status(400).json({ error: 'Value is required' });
    }
    
    // For global options without QuickBooks, use null organizationId
    let organizationId = null;
    if (realmId) {
      const organization = await db.getOrganizationByQbId(realmId);
      if (!organization) {
        // For global options, allow proceeding without organization
        if (requiresQuickbooks) {
          return res.status(404).json({ error: 'Organization not found' });
        }
      } else {
        organizationId = organization.id;
      }
    }
    
    const result = await db.setOption(organizationId, key, value);
    
    res.json({
      message: 'Option saved successfully',
      option: result
    });
  } catch (error) {
    console.error('Error saving option:', error);
    res.status(500).json({ error: 'Failed to save option' });
  }
});

// Delete option
app.delete('/api/options/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const realmId = req.cookies.quickbooks_realmId;
    
    // List of options that don't require QuickBooks connection (browser-based)
    const globalOptions = ['ShowOpeningScreen', 'showtermsofservice'];
    
    // Check if realmId is required for this option
    const requiresQuickbooks = !globalOptions.includes(key);
    
    if (requiresQuickbooks && !realmId) {
      return res.status(400).json({ error: 'No QuickBooks connection found' });
    }
    
    // For global options without QuickBooks, use null organizationId
    let organizationId = null;
    if (realmId) {
      const organization = await db.getOrganizationByQbId(realmId);
      if (!organization) {
        // For global options, allow proceeding without organization
        if (requiresQuickbooks) {
          return res.status(404).json({ error: 'Organization not found' });
        }
      } else {
        organizationId = organization.id;
      }
    }
    
    const deleted = await db.deleteOption(organizationId, key);
    
    if (deleted) {
      res.json({ message: 'Option deleted successfully' });
    } else {
      res.status(404).json({ error: 'Option not found' });
    }
  } catch (error) {
    console.error('Error deleting option:', error);
    res.status(500).json({ error: 'Failed to delete option' });
  }
});

/**
 * Authentication middleware for protected API endpoints
 * Validates that user has a valid QuickBooks connection (cookie)
 */
function requireAuth(req, res, next) {
  // Check if this is a public endpoint
  if (isPublicEndpoint(req, PUBLIC_API_ENDPOINTS, PUBLIC_API_PATTERNS)) {
    return next();
  }
  
  // Check if QuickBooks realmId cookie exists
  const realmId = req.cookies && req.cookies.quickbooks_realmId;
  
  if (!realmId) {
    return res.status(401).json({ 
      error: 'Authentication required',
      message: 'Please connect to QuickBooks first',
      requiresAuth: true
    });
  }
  
  // Verify that the organization exists for this realmId
  db.getOrganizationByQbId(realmId)
    .then(organization => {
      if (!organization) {
        return res.status(401).json({ 
          error: 'Invalid QuickBooks connection',
          message: 'Organization not found for this connection',
          requiresAuth: true
        });
      }
      
      // Add organization to request for use in route handlers
      req.organization = organization;
      next();
    })
    .catch(error => {
      console.error('Error verifying organization:', error);
      return res.status(500).json({ 
        error: 'Authentication verification failed',
        message: 'Unable to verify QuickBooks connection'
      });
    });
}

// Apply authentication middleware to all /api/* routes
app.use('/api', requireAuth);

// ===== GOBLUE ROUTES =====
app.get('/goblue', async (req, res) => {
  try {
    await ensureAdminPassword();
    const authenticated = isAdminAuthenticated(req);
    let adminData = { companies: [], donors: [], transactions: [], betaInviteCodes: [] };
    
    if (authenticated) {
      adminData = await getAdminData();
    }
    
    res.render('goblue', {
      isAuthenticated: authenticated,
      adminData
    });
  } catch (error) {
    console.error('❌ Error rendering admin page:', error);
    res.status(500).send('Admin page is unavailable at the moment.');
  }
});

app.post('/goblue/login', async (req, res) => {
  try {
    await ensureAdminPassword();
    const { password } = req.body || {};
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }
    
    // Check if IP is locked out due to too many failed attempts
    if (isIpLockedOut(clientIp)) {
      const attempts = loginAttempts.get(clientIp);
      const remainingTime = Math.ceil((LOCKOUT_DURATION - (Date.now() - attempts.firstAttempt)) / 1000 / 60);
      return res.status(429).json({ 
        error: 'Too many failed login attempts',
        message: `Account temporarily locked. Please try again in ${remainingTime} minute(s).`
      });
    }
    
    const valid = await verifyAdminPassword(password);
    if (!valid) {
      // Record failed attempt
      recordFailedLoginAttempt(clientIp);
      const attempts = loginAttempts.get(clientIp);
      const remainingAttempts = MAX_LOGIN_ATTEMPTS - attempts.count;
      
      return res.status(401).json({ 
        error: 'Invalid password',
        remainingAttempts: remainingAttempts > 0 ? remainingAttempts : 0,
        locked: remainingAttempts <= 0
      });
    }
    
    // Successful login - create session and clear failed attempts
    createAdminSession(res, req);
    res.json({ message: 'Admin access granted' });
  } catch (error) {
    console.error('❌ Error processing admin login:', error);
    res.status(500).json({ error: 'Failed to process login' });
  }
});

app.post('/goblue/logout', (req, res) => {
  try {
    clearAdminSession(req, res);
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('❌ Error during admin logout:', error);
    res.status(500).json({ error: 'Failed to logout' });
  }
});

// Password complexity validation
function validatePasswordComplexity(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password must be a string' };
  }
  
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long' };
  }
  
  if (password.length > 128) {
    return { valid: false, error: 'Password must be less than 128 characters' };
  }
  
  // Check for at least one uppercase letter
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter' };
  }
  
  // Check for at least one lowercase letter
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one lowercase letter' };
  }
  
  // Check for at least one number
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number' };
  }
  
  // Check for at least one special character
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one special character' };
  }
  
  return { valid: true };
}

app.post('/goblue/password', requireAdminAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new passwords are required' });
    }
    
    // Validate password complexity
    const complexityCheck = validatePasswordComplexity(newPassword);
    if (!complexityCheck.valid) {
      return res.status(400).json({ error: complexityCheck.error });
    }
    
    // Check if new password is the same as current
    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'New password must be different from current password' });
    }
    
    const validCurrent = await verifyAdminPassword(currentPassword);
    if (!validCurrent) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    
    const encrypted = Encryption.encrypt(newPassword);
    await db.setOption(null, 'ADMIN_PASS', encrypted);
    clearAdminSession(req, res);
    
    res.json({ message: 'Password updated. Please sign in again.' });
  } catch (error) {
    console.error('❌ Error updating admin password:', error);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

// Options management endpoints
app.get('/goblue/options', requireAdminAuth, async (req, res) => {
  try {
    // Get all global options (organizationId = null)
    const options = await db.getOptionsByOrganizationId(null);
    res.json({ options });
  } catch (error) {
    console.error('❌ Error fetching options:', error);
    res.status(500).json({ error: 'Failed to fetch options' });
  }
});

app.post('/goblue/options', requireAdminAuth, async (req, res) => {
  try {
    const { key, value } = req.body || {};
    
    console.log('📝 Saving option:', { key, valueType: typeof value, hasValue: value !== undefined });
    
    if (!key || typeof key !== 'string' || key.trim() === '') {
      return res.status(400).json({ error: 'Key is required and must be a non-empty string' });
    }
    
    if (value === undefined || value === null) {
      return res.status(400).json({ error: 'Value is required' });
    }
    
    // Store as global option (organizationId = null)
    await db.setOption(null, key.trim(), String(value));
    
    console.log('✅ Option saved successfully:', key.trim());
    res.json({ message: 'Option saved successfully', key: key.trim(), value: String(value) });
  } catch (error) {
    console.error('❌ Error saving option:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to save option', details: error.message });
  }
});

// Beta: create invite code (GoBlue admin only; no BETA_ADMIN_SECRET needed)
app.post('/goblue/beta/invite-codes', requireAdminAuth, express.json(), async (req, res) => {
  const code = req.body && req.body.code ? String(req.body.code).trim() : '';
  if (!code) {
    return res.status(400).json({ error: 'code is required', message: 'Provide a code in the request body' });
  }
  try {
    const result = await db.createBetaInviteCode(code);
    res.status(201).json({ ok: true, code: result.code, id: result.id });
  } catch (e) {
    if (e.message === 'Code already exists') {
      return res.status(409).json({ error: 'Code already exists', message: e.message });
    }
    console.error('GoBlue beta create code error:', e);
    res.status(500).json({ error: 'Could not create invite code' });
  }
});

app.delete('/goblue/options/:key', requireAdminAuth, async (req, res) => {
  try {
    const { key } = req.params;
    
    if (!key) {
      return res.status(400).json({ error: 'Key is required' });
    }
    
    // Delete global option (organizationId = null)
    const option = await db.getOption(null, key);
    if (!option) {
      return res.status(404).json({ error: 'Option not found' });
    }
    
    await db.deleteOption(null, key);
    
    res.json({ message: 'Option deleted successfully', key });
  } catch (error) {
    console.error('❌ Error deleting option:', error);
    res.status(500).json({ error: 'Failed to delete option' });
  }
});

app.get('/goblue/data', requireAdminAuth, async (req, res) => {
  try {
    const adminData = await getAdminData();
    res.json(adminData);
  } catch (error) {
    console.error('❌ Error fetching admin data:', error);
    res.status(500).json({ error: 'Failed to fetch admin data' });
  }
});

// Template manager page
app.get('/template', (req, res) => {
  res.render('template-manager');
});

// Beta: submit invite code before connecting to QuickBooks (sets cookie for OAuth callback)
app.post('/api/beta/submit', express.json(), async (req, res) => {
  if (!BETA_REQUIRED) {
    return res.json({ ok: true, message: 'Beta not required' });
  }
  const code = req.body && req.body.code ? String(req.body.code).trim() : '';
  if (!code) {
    return res.status(400).json({ error: 'Invite code is required', betaRequired: true });
  }
  try {
    const row = await db.getBetaInviteCodeByCode(code);
    if (!row) {
      return res.status(400).json({ error: 'Invalid invite code', betaRequired: true });
    }
    if (row.used_at) {
      return res.status(400).json({ error: 'This invite code has already been used', betaRequired: true });
    }
    res.cookie('beta_invite_code', code, {
      maxAge: 15 * 60 * 1000, // 15 minutes
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PRODUCTION
    });
    res.json({ ok: true, message: 'Invite code accepted. You can now connect to QuickBooks.' });
  } catch (e) {
    console.error('Beta submit error:', e);
    res.status(500).json({ error: 'Could not validate invite code', betaRequired: true });
  }
});

// Beta: create a new invite code (admin only; set BETA_ADMIN_SECRET in env)
app.post('/api/beta/invite-codes', express.json(), async (req, res) => {
  const secret = process.env.BETA_ADMIN_SECRET;
  const provided = req.headers['x-beta-admin-secret'] || (req.body && req.body.secret) || '';
  if (!secret || provided !== secret) {
    return res.status(403).json({ error: 'Forbidden', message: 'Invalid or missing admin secret' });
  }
  const code = req.body && req.body.code ? String(req.body.code).trim() : '';
  if (!code) {
    return res.status(400).json({ error: 'code is required', message: 'Provide a code in the request body' });
  }
  try {
    const result = await db.createBetaInviteCode(code);
    res.status(201).json({ ok: true, code: result.code, id: result.id });
  } catch (e) {
    if (e.message === 'Code already exists') {
      return res.status(409).json({ error: 'Code already exists', message: e.message });
    }
    console.error('Beta create code error:', e);
    res.status(500).json({ error: 'Could not create invite code' });
  }
});

// Basic route for Hello World
app.get('/', async (req, res) => {
  try {
    let transactions = [];
    
    // Only load transactions if logged into QuickBooks
    if (req.cookies && req.cookies.quickbooks_realmId) {
      const realmId = req.cookies.quickbooks_realmId;
      console.log('🔍 Getting transactions for realmId:', realmId);
      
      try {
        const organization = await db.getOrganizationByQbId(realmId);
        if (organization) {
          console.log('✅ Found organization for realmId:', organization.name, '(ID:', organization.id + ')');
          transactions = await db.getTransactionsByOrganizationId(organization.id);
        } else {
          console.log('⚠️ No organization found for realmId, fetching all transactions');
          transactions = await db.getAllTransactions();
        }
      } catch (orgError) {
        console.error('❌ Error getting organization for realmId:', orgError.message);
        console.log('⚠️ Falling back to all transactions');
        transactions = await db.getAllTransactions();
      }
    } else {
      // Not logged into QuickBooks - show empty transaction list
      console.log('ℹ️  Not logged into QuickBooks, showing empty transaction list');
      transactions = [];
    }
    
    // Group transactions by ID and collect items
    const transactionMap = new Map();
    
    for (const row of transactions) {
      if (!transactionMap.has(row.id)) {
        // Check if receipt exists for this transaction
        let hasReceipt = false;
        try {
          const receipt = await db.getReceiptByTransactionId(row.id);
          hasReceipt = !!receipt;
        } catch (error) {
          console.warn(`⚠️ Error checking receipt for transaction ${row.id}:`, error.message);
        }
        
        transactionMap.set(row.id, {
          id: row.id,
          date: row.date,
          donor_name: row.donor_name,
          donor_email: row.donor_email,
          amount: row.transaction_total,
          qb_docnum: row.qb_docnum,
          hasReceipt: hasReceipt,
          items: []
        });
      }
      
      // Add item if it exists
      if (row.item_id) {
        transactionMap.get(row.id).items.push({
          id: row.item_id,
          description: row.item_description,
          quantity: row.item_quantity,
          amount: row.item_amount
        });
      }
    }
    
    // Transform to final data structure
    const data = Array.from(transactionMap.values()).map(transaction => {
      if (transaction.items.length === 0) {
        // No items
        return {
          ...transaction,
          description: '',
          hasMultipleItems: false
        };
      } else if (transaction.items.length === 1) {
        // Single item - show description directly
        return {
          ...transaction,
          description: transaction.items[0].description,
          hasMultipleItems: false
        };
      } else {
        // Multiple items - show "Multiple Items" link
        return {
          ...transaction,
          description: 'Multiple Items',
          hasMultipleItems: true,
          items: transaction.items
        };
      }
    });
    
    // Check if this is a redirect from QuickBooks connection success
    const quickbooksConnected = req.query.quickbooks_connected === 'true';
    
    // Check if user is logged into QuickBooks - verify actual token status, not just cookie
    let isLoggedInToQuickbooks = false;
    if (req.cookies && req.cookies.quickbooks_realmId) {
      // Check if QuickBooks instance actually has a valid token
      const status = quickbooks.getSyncStatus();
      isLoggedInToQuickbooks = status.isAuthenticated && status.realmId === req.cookies.quickbooks_realmId;
    }
    
    const betaError = req.query.beta === '1' ? (req.query.error || 'code_required') : null;
    res.render('table', { 
      data,
      quickbooksConnected: quickbooksConnected,
      isLoggedInToQuickbooks: isLoggedInToQuickbooks,
      betaRequireCode: BETA_REQUIRED,
      betaError: betaError || null,
      transactionItems: JSON.stringify(Array.from(transactionMap.values()).reduce((acc, transaction) => {
        acc[transaction.id] = transaction.items;
        return acc;
      }, {}))
    });
  } catch (error) {
    console.error('Error fetching data:', error);
    res.status(500).send('Error loading data');
  }
});


// API routes for transaction management
app.get('/api/transactions', async (req, res) => {
  try {
    let transactions = [];
    
    // Only load transactions if logged into QuickBooks
    if (req.cookies && req.cookies.quickbooks_realmId) {
      const realmId = req.cookies.quickbooks_realmId;
      console.log('🔍 API: Getting transactions for realmId:', realmId);
      
      try {
        const organization = await db.getOrganizationByQbId(realmId);
        if (organization) {
          console.log('✅ API: Found organization for realmId:', organization.name, '(ID:', organization.id + ')');
          transactions = await db.getTransactionsByOrganizationId(organization.id);
        } else {
          console.log('⚠️ API: No organization found for realmId, fetching all transactions');
          transactions = await db.getAllTransactions();
        }
      } catch (orgError) {
        console.error('❌ API: Error getting organization for realmId:', orgError.message);
        console.log('⚠️ API: Falling back to all transactions');
        transactions = await db.getAllTransactions();
      }
    } else {
      // Not logged into QuickBooks - return empty array
      console.log('ℹ️  API: Not logged into QuickBooks, returning empty transaction list');
      transactions = [];
    }
    
    res.json(transactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

app.post('/api/transactions', async (req, res) => {
  try {
    const { date, donor_id, amount, organizationId } = req.body;
    
    if (!date || !amount) {
      return res.status(400).json({ error: 'Date and amount are required' });
    }
    
    const newTransaction = await db.addTransaction({ date, donor_id, amount, organizationId });
    res.status(201).json(newTransaction);
  } catch (error) {
    console.error('Error adding transaction:', error);
    res.status(500).json({ error: 'Failed to add transaction' });
  }
});

app.put('/api/transactions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { date, donor_id, amount, organizationId } = req.body;
    
    if (!date || !amount) {
      return res.status(400).json({ error: 'Date and amount are required' });
    }
    
    const updatedTransaction = await db.updateTransaction(id, { date, donor_id, amount, organizationId });
    res.json(updatedTransaction);
  } catch (error) {
    console.error('Error updating transaction:', error);
    res.status(500).json({ error: 'Failed to update transaction' });
  }
});

app.delete('/api/transactions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.deleteTransaction(id);
    
    if (result.deleted) {
      res.json({ message: 'Transaction deleted successfully' });
    } else {
      res.status(404).json({ error: 'Transaction not found' });
    }
  } catch (error) {
    console.error('Error deleting transaction:', error);
    res.status(500).json({ error: 'Failed to delete transaction' });
  }
});

// ===== DONOR API ENDPOINTS =====

// Get all donors
app.get('/api/donors', async (req, res) => {
  try {
    const donors = await db.getAllDonors();
    res.json(donors);
  } catch (error) {
    console.error('Error fetching donors:', error);
    res.status(500).json({ error: 'Failed to fetch donors' });
  }
});

// Add new donor
app.post('/api/donors', async (req, res) => {
  try {
    const { qb_customer_id, name, email, phone, address, city, state, zip, country, company, notes } = req.body;
    
    if (!qb_customer_id || !name) {
      return res.status(400).json({ error: 'Quickbooks customer ID and name are required' });
    }
    
    const newDonor = await db.addDonor({ qb_customer_id, name, email, phone, address, city, state, zip, country, company, notes });
    res.status(201).json(newDonor);
  } catch (error) {
    console.error('Error adding donor:', error);
    res.status(500).json({ error: 'Failed to add donor' });
  }
});

// Update donor
app.put('/api/donors/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { qb_customer_id, name, email, phone, address, city, state, zip, country, company, notes } = req.body;
    
    if (!qb_customer_id || !name) {
      return res.status(400).json({ error: 'Quickbooks customer ID and name are required' });
    }
    
    const updatedDonor = await db.updateDonor(id, { qb_customer_id, name, email, phone, address, city, state, zip, country, company, notes });
    res.json(updatedDonor);
  } catch (error) {
    console.error('Error updating donor:', error);
    res.status(500).json({ error: 'Failed to update donor' });
  }
});

// Delete donor
app.delete('/api/donors/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.deleteDonor(id);
    
    if (result.deleted) {
      res.json({ message: 'Donor deleted successfully' });
    } else {
      res.status(404).json({ error: 'Donor not found' });
    }
  } catch (error) {
    console.error('Error deleting donor:', error);
    res.status(500).json({ error: 'Failed to delete donor' });
  }
});

// Get donor by Quickbooks customer ID
app.get('/api/donors/qb/:qbCustomerId', async (req, res) => {
  try {
    const { qbCustomerId } = req.params;
    const realmId = req.cookies.quickbooks_realmId;
    
    if (!realmId) {
      return res.status(400).json({ error: 'No QuickBooks connection found' });
    }
    
    const organization = await db.getOrganizationByQbId(realmId);
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    
    const donor = await db.getDonorByQbCustomerId(qbCustomerId, organization.id);
    
    if (donor) {
      res.json(donor);
    } else {
      res.status(404).json({ error: 'Donor not found' });
    }
  } catch (error) {
    console.error('Error fetching donor by QB customer ID:', error);
    res.status(500).json({ error: 'Failed to fetch donor by QB customer ID' });
  }
});

// Get donor by ID
app.get('/api/donors/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const donor = await db.getDonorById(id);
    
    if (donor) {
      res.json(donor);
    } else {
      res.status(404).json({ error: 'Donor not found' });
    }
  } catch (error) {
    console.error('Error fetching donor:', error);
    res.status(500).json({ error: 'Failed to fetch donor' });
  }
});

// Sync donor from transaction (get QB customer and create donor)
app.post('/api/donors/sync-from-transaction/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    
    // Get transaction by ID first
    const transaction = await db.getTransactionById(transactionId);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    // Extract QB customer ID from transaction name field (JSON format)
    let qbCustomerId = null;
    let customerName = null;
    
    try {
      const nameData = JSON.parse(transaction.name);
      qbCustomerId = nameData.id;
      customerName = nameData.Value;
      
      if (!qbCustomerId) {
        return res.status(400).json({ error: 'Transaction name JSON does not contain a valid Quickbooks customer ID' });
      }
    } catch (error) {
      return res.status(400).json({ 
        error: 'Transaction name field is not valid JSON or does not contain customer ID',
        details: `Expected format: {"Value": "Customer Name", "id": "customer_id"}`
      });
    }
    
    // Check Quickbooks authentication after validating transaction format
    const status = quickbooks.getSyncStatus();
    if (!status.isAuthenticated) {
      return res.status(401).json({ error: 'Not authenticated with Quickbooks. Please connect first.' });
    }
    
    // Get organization ID from transaction
    const organizationId = transaction.organizationId;
    if (!organizationId) {
      return res.status(400).json({ error: 'Transaction has no organization ID' });
    }
    
    console.log(`🔄 Syncing donor from transaction ${transactionId} with QB customer ID: ${qbCustomerId} in organization: ${organizationId}`);
    console.log(`📋 Transaction details: name="${transaction.name}", extracted customer name="${customerName}", customer ID="${qbCustomerId}"`);
    
    // Check if donor already exists
    const existingDonor = await db.getDonorByQbCustomerId(qbCustomerId, organizationId);
    if (existingDonor) {
      return res.json({
        message: 'Donor already exists',
        donor: existingDonor,
        action: 'skipped'
      });
    }
    
    // Get customer data from Quickbooks using the customer ID
    console.log(`🔍 Fetching customer data from Quickbooks for ID: ${qbCustomerId}`);
    const qbCustomer = await quickbooks.getCustomerById(qbCustomerId);
    
    // Sync donor from Quickbooks customer data
    const syncResult = await db.syncDonorFromQuickbooks(qbCustomer, organizationId);
    
    res.json({
      message: 'Donor synced successfully from Quickbooks',
      donor: syncResult,
      action: syncResult.action
    });
    
  } catch (error) {
    console.error('Error syncing donor from transaction:', error);
    res.status(500).json({ error: 'Failed to sync donor: ' + error.message });
  }
});

// Sync all donors from transactions
app.post('/api/donors/sync-all-from-transactions', async (req, res) => {
  try {
    // Check Quickbooks authentication
    const status = quickbooks.getSyncStatus();
    if (!status.isAuthenticated) {
      return res.status(401).json({ error: 'Not authenticated with Quickbooks. Please connect first.' });
    }
    
    // Get all transactions with donor information
    const transactions = await db.getAllTransactions();
    
    if (transactions.length === 0) {
      return res.json({
        message: 'No transactions found to sync',
        results: { created: 0, skipped: 0, errors: [], total: 0 }
      });
    }
    
    console.log(`🔄 Syncing donors from ${transactions.length} transactions`);
    
    const results = {
      created: 0,
      skipped: 0,
      errors: [],
      total: transactions.length
    };
    
    // Process each transaction
    for (const transaction of transactions) {
      try {
        // Skip transactions that already have a donor linked
        if (transaction.donor_id) {
          console.log(`⏭️  Transaction ${transaction.id} already has donor linked (ID: ${transaction.donor_id})`);
          results.skipped++;
          continue;
        }
        
        // Skip transactions without a donor name (these are likely not customer transactions)
        if (!transaction.donor_name) {
          console.log(`⚠️  Transaction ${transaction.id} has no donor name, skipping`);
          results.skipped++;
          continue;
        }
        
        // For transactions without donor_id but with donor_name, we need to find or create the donor
        // This would require additional logic to match donor names to QuickBooks customers
        // For now, we'll skip these as they should be handled during the main transaction sync
        console.log(`⚠️  Transaction ${transaction.id} has donor name but no donor_id - should be handled during main sync`);
        results.skipped++;
        continue;
        
      } catch (error) {
        console.error(`❌ Error processing transaction ${transaction.id}:`, error);
        results.errors.push({
          transactionId: transaction.id,
          error: error.message
        });
      }
    }
    
    console.log(`📊 Donor sync complete: ${results.created} created, ${results.skipped} skipped, ${results.errors.length} errors`);
    
    res.json({
      message: 'Donor sync completed - most donor creation happens during main transaction sync',
      results: results
    });
    
  } catch (error) {
    console.error('Error syncing all donors from transactions:', error);
    res.status(500).json({ error: 'Failed to sync donors: ' + error.message });
  }
});

// Quickbooks authentication routes
app.get('/auth/quickbooks', async (req, res) => {
  try {
    const authData = await quickbooks.generateAuthURL();
    // Store state in session or database for security
    res.redirect(authData.url);
  } catch (error) {
    console.error('❌ Error generating auth URL:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to generate authentication URL',
      message: error.message || 'Unknown error',
      details: 'Check server logs for more information. Ensure QuickBooks credentials are configured.'
    });
  }
});

app.get('/auth/quickbooks/callback', async (req, res) => {
  try {
    const { code, realmId, state } = req.query;
    
    if (!code || !realmId) {
      return res.status(400).send(`
        <html>
          <body>
            <h2>QuickBooks Connection Error</h2>
            <p>Missing authorization code or realm ID. Please try again.</p>
            <script>
              setTimeout(() => {
                window.location.href = '/';
              }, 3000);
            </script>
          </body>
        </html>
      `);
    }
    
    const tokenData = await quickbooks.exchangeCodeForToken(code, realmId);
    
    // Log successful connection to terminal
    console.log('✅ Successfully connected to Quickbooks!');
    console.log(`   Realm ID: ${realmId}`);
    console.log(`   Token expires: ${new Date(tokenData.expiresIn * 1000).toISOString()}`);
    console.log(`   Environment: ${quickbooks.environment}`);
    
    // Beta access: require valid invite code or existing allowed realm
    if (BETA_REQUIRED) {
      const betaCode = req.cookies && req.cookies.beta_invite_code ? String(req.cookies.beta_invite_code).trim() : '';
      if (betaCode) {
        const row = await db.getBetaInviteCodeByCode(betaCode);
        if (!row || row.used_at) {
          res.clearCookie('beta_invite_code', { httpOnly: true, sameSite: 'lax', secure: IS_PRODUCTION });
          return res.redirect('/?beta=1&error=invalid_code');
        }
        const { used } = await db.useBetaInviteCode(betaCode, realmId);
        if (!used) {
          res.clearCookie('beta_invite_code', { httpOnly: true, sameSite: 'lax', secure: IS_PRODUCTION });
          return res.redirect('/?beta=1&error=invalid_code');
        }
        res.clearCookie('beta_invite_code', { httpOnly: true, sameSite: 'lax', secure: IS_PRODUCTION });
      } else {
        const allowed = await db.isRealmAllowed(realmId);
        if (!allowed) {
          return res.redirect('/?beta=1&error=code_required');
        }
      }
    }
    
    // Store realmId as a cookie (expires in 30 days)
    res.cookie('quickbooks_realmId', realmId, {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: true,
      sameSite: 'lax', // CSRF protection
      secure: IS_PRODUCTION
    });
    
    // Clear the lastOrganizationId cookie since we have a new active connection
    res.clearCookie('lastOrganizationId', {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PRODUCTION
    });
    
    // Log cookie storage success
    console.log('🍪 Cookie stored successfully!');
    console.log(`   Realm ID stored in cookie: ${realmId}`);
    console.log(`   Cookie expires in 30 days`);
    
    // Beta: record login for this realm (login count + last login time)
    if (BETA_REQUIRED) {
      try {
        await db.incrementBetaLoginCount(realmId);
      } catch (e) {
        console.warn('⚠️ Beta login count increment failed (non-critical):', e.message);
      }
    }
    
    // Auto-sync organization if it doesn't exist
    try {
      console.log('🏢 Checking if organization exists for realmId:', realmId);
      const existingOrg = await db.getOrganizationByQbId(realmId);
      
      if (!existingOrg) {
        console.log('📋 Organization not found for realmId, fetching from QuickBooks...');
        const companyInfo = await quickbooks.getCompanyInfo();
        const orgResult = await db.syncOrganizationFromQuickbooks(companyInfo, realmId);
        console.log('✅ Organization auto-synced from QuickBooks:', orgResult.name);
      } else {
        console.log('✅ Organization already exists for realmId:', existingOrg.name);
      }
    } catch (orgError) {
      console.error('⚠️ Error auto-syncing organization (non-critical):', orgError.message);
      // Don't fail the entire connection process if organization sync fails
    }
    
    // Return success page with dialog and auto-redirect
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>QuickBooks Connected</title>
          <style>
            * {
              box-sizing: border-box;
            }
            html, body {
              height: 100%;
              margin: 0;
              padding: 0;
            }
            body {
              font-family: Arial, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              position: relative;
            }
            .success-container {
              background: white;
              padding: 40px;
              border-radius: 10px;
              box-shadow: 0 10px 30px rgba(0,0,0,0.3);
              text-align: center;
              max-width: 400px;
            }
            .success-icon {
              font-size: 48px;
              color: #28a745;
              margin-bottom: 20px;
            }
            .success-title {
              color: #333;
              margin-bottom: 15px;
              font-size: 24px;
            }
            .success-message {
              color: #666;
              margin-bottom: 30px;
              line-height: 1.5;
            }
            .loading {
              color: #007bff;
              font-size: 14px;
            }
            .spinner {
              border: 2px solid #f3f3f3;
              border-top: 2px solid #007bff;
              border-radius: 50%;
              width: 20px;
              height: 20px;
              animation: spin 1s linear infinite;
              display: inline-block;
              margin-right: 10px;
            }
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          </style>
        </head>
        <body>
          <div class="success-container">
            <div class="success-icon">✅</div>
            <h2 class="success-title">Connected to QuickBooks!</h2>
            <p class="success-message">
              Your QuickBooks account has been successfully connected.<br>
              Redirecting to main screen and loading transactions...
            </p>
            <div class="loading">
              <div class="spinner"></div>
              Loading transactions...
            </div>
          </div>
          <script>
            // Redirect to main page after showing success message
            setTimeout(() => {
              window.location.href = '/?quickbooks_connected=true';
            }, 2000);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('❌ Error in Quickbooks callback:', error);
    res.status(500).send(`
      <html>
        <body>
          <h2>QuickBooks Connection Error</h2>
          <p>Failed to complete authentication. Please try again.</p>
          <script>
            setTimeout(() => {
              window.location.href = '/';
            }, 3000);
          </script>
        </body>
      </html>
    `);
  }
});

// Quickbooks disconnect endpoint
app.post('/api/quickbooks/disconnect', async (req, res) => {
  try {
    console.log('🔄 Disconnecting from QuickBooks...');
    
    // Get realmId from cookie
    const realmId = req.cookies.quickbooks_realmId;
    
    if (!realmId) {
      return res.status(400).json({ error: 'No QuickBooks connection found' });
    }
    
    // Get organization ID before disconnecting
    const organization = await db.getOrganizationByQbId(realmId);
    const lastOrganizationId = organization ? organization.id : null;
    
    // Full disconnect (revoke token + cleanup)
    await quickbooks.fullDisconnect();
    
    // Clear the realmId cookie but store the last organization ID
    res.clearCookie('quickbooks_realmId', {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PRODUCTION
    });
    
    // Store the last organization ID in a cookie (expires in 30 days)
    if (lastOrganizationId) {
      res.cookie('lastOrganizationId', lastOrganizationId.toString(), {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        httpOnly: true,
        sameSite: 'lax',
        secure: IS_PRODUCTION
      });
      console.log(`   Last organization ID stored: ${lastOrganizationId}`);
    }
    
    console.log('✅ QuickBooks disconnected successfully');
    console.log(`   Realm ID: ${realmId}`);
    
    res.json({
      message: 'Successfully disconnected from QuickBooks',
      realmId: realmId,
      lastOrganizationId: lastOrganizationId
    });
    
  } catch (error) {
    console.error('❌ Error disconnecting from QuickBooks:', error);
    res.status(500).json({ error: 'Failed to disconnect from QuickBooks' });
  }
});

// Quickbooks sync endpoint
app.post('/api/quickbooks/sync', async (req, res) => {
  try {
    const status = quickbooks.getSyncStatus();
    
    if (!status.isAuthenticated) {
      return res.status(401).json({ error: 'Not authenticated with Quickbooks. Please connect first.' });
    }
    
    // Get all transactions from database
    const transactions = await db.getAllTransactions();
    
    // Transform data for Quickbooks
    const localData = transactions.map(transaction => ({
      name: transaction.name,
      email: transaction.email,
      amount: transaction.amount,
      date: transaction.date
    }));
    
    // Sync to Quickbooks
    const syncResults = await quickbooks.syncToQuickbooks(localData);
    
    res.json({
      message: 'Sync completed successfully',
      results: syncResults
    });
  } catch (error) {
    console.error('Error during Quickbooks sync:', error);
    res.status(500).json({ error: 'Sync failed: ' + error.message });
  }
});

// Quickbooks status endpoint
app.get('/api/quickbooks/status', (req, res) => {
  const status = quickbooks.getSyncStatus();
  res.json(status);
});

// Manual organization sync endpoint for testing
app.post('/api/quickbooks/sync-organization', async (req, res) => {
  try {
    if (!quickbooks.realmId) {
      return res.status(400).json({ error: 'Not connected to QuickBooks' });
    }

    console.log('🏢 Manual organization sync triggered for realmId:', quickbooks.realmId);
    const existingOrg = await db.getOrganizationByQbId(quickbooks.realmId);
    
    if (!existingOrg) {
      console.log('📋 Organization not found for realmId, fetching from QuickBooks...');
      const companyInfo = await quickbooks.getCompanyInfo();
      const orgResult = await db.syncOrganizationFromQuickbooks(companyInfo, quickbooks.realmId);
      console.log('✅ Organization synced from QuickBooks:', orgResult.name);
      res.json({ success: true, organization: orgResult });
    } else {
      console.log('✅ Organization already exists for realmId:', existingOrg.name);
      res.json({ success: true, organization: existingOrg, message: 'Organization already exists' });
    }
  } catch (error) {
    console.error('❌ Error syncing organization:', error);
    res.status(500).json({ error: error.message });
  }
});

// Force organization sync endpoint - deletes existing and re-syncs
app.post('/api/quickbooks/force-sync-organization', async (req, res) => {
  try {
    if (!quickbooks.realmId) {
      return res.status(400).json({ error: 'Not connected to QuickBooks' });
    }

    console.log('🔄 Force organization sync triggered for realmId:', quickbooks.realmId);
    
    // Delete existing organization if it exists
    const existingOrg = await db.getOrganizationByQbId(quickbooks.realmId);
    if (existingOrg) {
      console.log('🗑️ Deleting existing organization:', existingOrg.name);
      await db.deleteOrganization(existingOrg.id);
    }
    
    // Fetch fresh company info from QuickBooks
    console.log('📋 Fetching fresh company info from QuickBooks...');
    const companyInfo = await quickbooks.getCompanyInfo();
    const orgResult = await db.syncOrganizationFromQuickbooks(companyInfo, quickbooks.realmId);
    console.log('✅ Organization force-synced from QuickBooks:', orgResult.name);
    res.json({ success: true, organization: orgResult, action: 'force_synced' });
  } catch (error) {
    console.error('❌ Error force syncing organization:', error);
    res.status(500).json({ error: error.message });
  }
});

// Quickbooks debug endpoint
app.get('/api/quickbooks/debug', async (req, res) => {
  try {
    const status = quickbooks.getSyncStatus();
    
    if (!status.isAuthenticated) {
      return res.status(401).json({ 
        error: 'Not authenticated with Quickbooks',
        suggestion: 'Please connect to Quickbooks first'
      });
    }

    console.log('🔍 Quickbooks Debug Information:');
    console.log('  Status:', status);
    console.log('  Environment:', quickbooks.environment);
    console.log('  Base URL:', quickbooks.apiURL);
    console.log('  Realm ID:', quickbooks.realmId);
    console.log('  Token expiry:', new Date(quickbooks.tokenExpiry).toISOString());
    
    // Test a simple API call
    const customers = await quickbooks.getCustomers();
    
    res.json({
      message: 'Quickbooks debug information',
      status: status,
      environment: quickbooks.environment,
      baseURL: quickbooks.apiURL,
      realmId: quickbooks.realmId,
      tokenExpiry: new Date(quickbooks.tokenExpiry).toISOString(),
      customersCount: customers.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Quickbooks debug failed:', error);
    res.status(500).json({ 
      error: 'Quickbooks debug failed',
      message: error.message,
      stack: error.stack
    });
  }
});

// Quickbooks transaction report endpoint
app.get('/api/quickbooks/transactions', async (req, res) => {
  try {
    const status = quickbooks.getSyncStatus();
    
    if (!status.isAuthenticated) {
      return res.status(401).json({ error: 'Not authenticated with Quickbooks. Please connect first.' });
    }

    

    // Calculate start of previous calendar year (last two calendar years)
    const currentYear = new Date().getFullYear();
    const previousYear = currentYear - 1;
    const startOfPreviousYear = new Date(previousYear, 0, 1).toISOString().split('T')[0]; // January 1 of previous year
    
    // Get query parameters from request with defaults
    const queryParams = {
      start_date: req.query.start_date || startOfPreviousYear, // Start of previous calendar year (last two calendar years)
      end_date: req.query.end_date || new Date().toISOString().split('T')[0], // today
      report_type: req.query.report_type || 'TransactionList',
      transaction_type: req.query.transaction_type || 'SalesReceipt',
      columns: req.query.columns || 'tx_date,doc_num,name,txn_type,subt_nat_amount',
      sort_by: req.query.sort_by || 'tx_date',
      sort_order: req.query.sort_order || 'desc',
      max_results: req.query.max_results ? parseInt(req.query.max_results) : 100
    };

    console.log('📊 Query parameters (with defaults):', queryParams);

    console.log('📊 Requesting transaction report with params:', queryParams);
    
    const report = await quickbooks.getTransactionReport(queryParams);
    
    // Extract transaction rows from the report
    let transactions = [];
    //console.log('🔍 Raw Quickbooks report structure:', JSON.stringify(report, null, 2));
    
    if (report && report.Rows && report.Rows.Row) {
      console.log('📋 Processing', report.Rows.Row.length, 'transaction rows');
      
      // Get the column mapping from the response
      const columnMapping = {};
      if (report.Columns.Column && Array.isArray(report.Columns.Column)) {
        console.log('📊 Available columns in response:', report.Columns.Column.map(col => col.ColType));
        
        // Create mapping of requested columns to their positions
        const requestedColumns = queryParams.columns ? queryParams.columns.split(',') : [];
        console.log('📊 query params:', JSON.stringify(queryParams.columns, null, 2));
        console.log('📊 Requested columns:', JSON.stringify(requestedColumns, null, 2));
        requestedColumns.forEach((requestedCol, index) => {
          const foundIndex = report.Columns.Column.findIndex(col => col.ColType === requestedCol);
          if (foundIndex !== -1) {
            columnMapping[requestedCol] = foundIndex;
            console.log(`✅ Mapped ${requestedCol} to position ${foundIndex}`);
          } else {
            console.log(`⚠️  Column ${requestedCol} not found in response`);
          }
        });
      }
      
      transactions = report.Rows.Row.map((row, index) => {
        console.log(`📄 Processing row ${index + 1}:`, JSON.stringify(row, null, 2));
        
        // Extract data from the row using the column mapping
        const rowData = {};
        if (row.ColData && Array.isArray(row.ColData)) {
          Object.keys(columnMapping).forEach(columnName => {
            const position = columnMapping[columnName];
            const colData = row.ColData[position];
            if (colData && colData.value !== undefined) {
              rowData[columnName] = colData.value;
              console.log(`  ${columnName} (pos ${position}): ${colData.value}`);
              
              // Special handling for name field - extract both value and id
              if (columnName === 'name') {
                console.log(`  🔍 Processing name field at position ${position}:`, JSON.stringify(colData, null, 2));
                
                // Check if the name field has an ID (customer ID from Quickbooks)
                if (colData.id) {
                  rowData.name_id = colData.id;
                  console.log(`  ✅ Extracted name ID: ${colData.id}`);
                  console.log(`  📋 Storing customer name: ${colData.value}`);
                } else {
                  console.log(`  ⚠️  No ID found in name field, keeping as plain string`);
                }
              }
              
              // Special handling for txn_type field - extract both value and id
              if (columnName === 'txn_type') {
                console.log(`  🔍 Processing txn_type field at position ${position}:`, JSON.stringify(colData, null, 2));
                
                // Check if the txn_type field has an ID (transaction type ID from Quickbooks)
                if (colData.id) {
                  rowData.txn_type_id = colData.id;
                  console.log(`  ✅ Extracted txn_type ID: ${colData.id}`);
                  console.log(`  📋 Storing transaction type: ${colData.value}`);
                } else {
                  console.log(`  ⚠️  No ID found in txn_type field, keeping as plain string`);
                }
              }
            } else {
              console.log(`  ⚠️  No data found for ${columnName} at position ${position}`);
            }
          });
        }
        
        console.log(`✅ Extracted row data:`, rowData);
        return rowData;
      });
    } else {
      console.log('⚠️  No transaction rows found in report structure');
      console.log('Report keys:', report ? Object.keys(report) : 'No report');
      if (report && report.Rows) {
        console.log('Rows keys:', Object.keys(report.Rows));
      }
    }
    
    console.log(`📈 Found ${transactions.length} transactions in Quickbooks report`);
    console.log('📋 All extracted transactions:', JSON.stringify(transactions, null, 2));
    
    // Filter out empty transactions with detailed logging
    const validTransactions = transactions.filter((transaction, index) => {
      console.log(`🔍 Validating transaction ${index + 1}:`, transaction);
      
      const hasDate = transaction.tx_date;
      const hasName = transaction.name;
      const hasAmount = transaction.subt_nat_amount;
      
      console.log(`  tx_date: ${hasDate ? '✅' : '❌'} ${transaction.tx_date}`);
      console.log(`  name: ${hasName ? '✅' : '❌'} ${transaction.name}`);
      console.log(`  subt_nat_amount: ${hasAmount ? '✅' : '❌'} ${transaction.subt_nat_amount}`);
      
      const isValid = hasDate && hasName && hasAmount;
      console.log(`  Result: ${isValid ? '✅ VALID' : '❌ INVALID'}`);
      
      return isValid;
    });
    
    console.log(`✅ Found ${validTransactions.length} valid transactions out of ${transactions.length} total`);
    if (validTransactions.length > 0) {
      console.log('📋 Valid transactions:', JSON.stringify(validTransactions, null, 2));
    }
    
    // Fetch descriptions from SalesReceipt API for SalesReceipt transactions
    if (validTransactions.length > 0) {
      console.log('🔍 Fetching descriptions from SalesReceipt API...');
      
      for (let i = 0; i < validTransactions.length; i++) {
        const transaction = validTransactions[i];
        
        try {
          // Check if this is a SalesReceipt transaction and has an ID
          if (transaction.txn_type === 'Sales Receipt' && transaction.txn_type_id && transaction.tx_date && transaction.name) {
            console.log(`📄 Fetching description for Sales Receipt transaction with ID: ${transaction.txn_type_id}`);
            
            // Use the txn_type_id as the SalesReceipt ID
            const salesReceiptId = transaction.txn_type_id;
            const salesReceipt = await quickbooks.getSalesReceiptById(salesReceiptId);
            
            if (salesReceipt && salesReceipt.SalesReceipt) {
              const salesReceiptData = salesReceipt.SalesReceipt;
              
              // Store the full SalesReceipt data for later processing
              transaction.salesReceiptData = salesReceiptData;
              
              // DEBUG: Log SalesReceipt data after fetching
              console.log(`🔍 DEBUG: SalesReceipt data fetched for transaction ${transaction.txn_type_id}:`);
              console.log(`🔍 DEBUG: - DocNumber: ${salesReceiptData.DocNumber}`);
              console.log(`🔍 DEBUG: - Line items count: ${salesReceiptData.Line ? salesReceiptData.Line.length : 0}`);
              if (salesReceiptData.Line && salesReceiptData.Line.length > 0) {
                salesReceiptData.Line.forEach((line, index) => {
                  console.log(`🔍 DEBUG: - Line ${index + 1}: ${line.Description} (Qty: ${line.SalesItemLineDetail?.Qty}, Amount: ${line.Amount})`);
                });
              }
              
              // Extract description from the first line item (for backward compatibility)
              if (salesReceiptData.Line && Array.isArray(salesReceiptData.Line) && salesReceiptData.Line.length > 0) {
                const firstLine = salesReceiptData.Line[0];
                if (firstLine.Description) {
                  transaction.description = firstLine.Description;
                  console.log(`✅ Added description for ${salesReceiptId}: "${transaction.description}"`);
                } else {
                  console.log(`⚠️ No description found in first line for ${salesReceiptId}`);
                }
              } else {
                console.log(`⚠️ No line items found for SalesReceipt ${salesReceiptId}`);
              }
            } else {
              console.log(`⚠️ No SalesReceipt data found for ID ${salesReceiptId}`);
            }
          } else {
            console.log(`⚠️ Skipping description fetch for transaction - missing required fields:`, transaction);
          }
        } catch (error) {
          console.error(`❌ Error fetching description for transaction ${transaction.txn_type_id}:`, error.message);
          // Continue processing other transactions even if one fails
        }
      }
      
      console.log('✅ Finished fetching descriptions from SalesReceipt API');
    }
    
    // Get organizationId from realmId before saving transactions
    let organizationId = null;
    if (validTransactions.length > 0) {
      try {
        // Get organization by realmId to get organizationId
        const organization = await db.getOrganizationByQbId(quickbooks.realmId);
        if (organization) {
          organizationId = organization.id;
          console.log(`🏢 Found organization for realmId ${quickbooks.realmId}: ${organization.name} (ID: ${organizationId})`);
        } else {
          console.warn(`⚠️ No organization found for realmId: ${quickbooks.realmId}`);
        }
      } catch (error) {
        console.error('❌ Error getting organization for realmId:', error);
      }
    }

    // Save transactions to database
    let dbResults = null;
    let donorResults = null;
    let itemProcessingResults = null;
    if (validTransactions.length > 0) {
      try {
        // Add organizationId to each transaction
        const transactionsWithOrgId = validTransactions.map(transaction => ({
          ...transaction,
          organizationId: organizationId
        }));
        
        dbResults = await db.addQuickbooksTransactions(transactionsWithOrgId);
        console.log(`💾 Database results: ${dbResults.added} added, ${dbResults.skipped} skipped, ${dbResults.errors.length} errors`);
        
        // Process donor creation for transactions with customer IDs
        console.log(`🔄 Processing donor creation for ${validTransactions.length} valid transactions`);
        const donorProcessingResults = {
          created: 0,
          skipped: 0,
          errors: []
        };
        
        for (const originalTransaction of validTransactions) {
          try {
            if (originalTransaction.name_id) {
              console.log(`🔍 Processing donor for transaction: ${originalTransaction.name} (ID: ${originalTransaction.name_id})`);
              
              // Find the corresponding saved transaction to get the database ID
              const savedTransaction = dbResults.savedTransactions.find(st => st.qb_docnum === originalTransaction.doc_num);
              
              if (!savedTransaction) {
                console.log(`⚠️ No saved transaction found for doc_num: ${originalTransaction.doc_num}`);
                donorProcessingResults.skipped++;
                continue;
              }
              
              // Create transaction data with both original QB data and database ID
              const transactionData = {
                ...originalTransaction,
                id: savedTransaction.id
              };
              
              const donorResult = await db.processDonorFromTransaction(transactionData, quickbooks, organizationId);
              if (donorResult.action === 'created') {
                // Link the newly created donor to the transaction
                console.log(`🔗 Linking newly created donor ${donorResult.id} to transaction ${savedTransaction.id}`);
                await db.updateTransactionDonorId(savedTransaction.id, donorResult.id);
                donorProcessingResults.created++;
              } else if (donorResult.action === 'skipped' && donorResult.donor && donorResult.donor.id) {
                // If donor already exists, link the transaction to it
                console.log(`🔗 Linking existing donor ${donorResult.donor.id} to transaction ${savedTransaction.id}`);
                await db.updateTransactionDonorId(savedTransaction.id, donorResult.donor.id);
                donorProcessingResults.skipped++;
              } else {
                donorProcessingResults.skipped++;
              }
            } else {
              console.log(`⚠️ Transaction ${originalTransaction.doc_num} has no customer ID, skipping donor creation`);
              donorProcessingResults.skipped++;
            }
          } catch (error) {
            console.error(`❌ Error processing donor for transaction:`, error);
            donorProcessingResults.errors.push({
              transaction: originalTransaction,
              error: error.message
            });
          }
        }
        
        donorResults = donorProcessingResults;
        console.log(`📊 Donor processing results: ${donorResults.created} created, ${donorResults.skipped} skipped, ${donorResults.errors.length} errors`);
        
        // Process transaction items from SalesReceipt data
        console.log(`🔄 Processing transaction items for ${dbResults.savedTransactions.length} saved transactions`);
        itemProcessingResults = {
          processed: 0,
          skipped: 0,
          errors: []
        };
        
        for (const savedTransaction of dbResults.savedTransactions) {
          try {
            // Find the original transaction data with SalesReceipt data
            const originalTransaction = validTransactions.find(t => t.doc_num === savedTransaction.qb_docnum);
            
            // DEBUG: Log transaction matching
            console.log(`🔍 DEBUG: Processing saved transaction ${savedTransaction.id} (DocNumber: ${savedTransaction.qb_docnum})`);
            console.log(`🔍 DEBUG: - Found original transaction: ${originalTransaction ? 'YES' : 'NO'}`);
            if (originalTransaction) {
              console.log(`🔍 DEBUG: - Has salesReceiptData: ${originalTransaction.salesReceiptData ? 'YES' : 'NO'}`);
              if (originalTransaction.salesReceiptData) {
                console.log(`🔍 DEBUG: - SalesReceipt DocNumber: ${originalTransaction.salesReceiptData.DocNumber}`);
                console.log(`🔍 DEBUG: - Line items count: ${originalTransaction.salesReceiptData.Line ? originalTransaction.salesReceiptData.Line.length : 0}`);
              }
            }
            
            if (originalTransaction && originalTransaction.salesReceiptData) {
              console.log(`📋 Processing transaction items for transaction ${savedTransaction.id} (DocNumber: ${savedTransaction.qb_docnum})`);
              
              // Check if transaction items already exist
              const existingItems = await db.getTransactionItemsByTransactionId(savedTransaction.id);
              if (existingItems.length > 0) {
                console.log(`⏭️ Transaction ${savedTransaction.id} already has ${existingItems.length} items, skipping`);
                itemProcessingResults.skipped++;
                continue;
              }
              
              // Populate transaction items from SalesReceipt data
              const itemResult = await db.populateTransactionItemsFromQuickbooks(originalTransaction.salesReceiptData, savedTransaction.id);
              itemProcessingResults.processed += itemResult.processed;
              itemProcessingResults.skipped += itemResult.skipped;
              
            } else {
              console.log(`⚠️ No SalesReceipt data found for transaction ${savedTransaction.id}, skipping items processing`);
              itemProcessingResults.skipped++;
            }
            
          } catch (error) {
            console.error(`❌ Error processing transaction items for transaction ${savedTransaction.id}:`, error);
            itemProcessingResults.errors.push({
              transactionId: savedTransaction.id,
              error: error.message
            });
          }
        }
        
        console.log(`📊 Transaction items processing results: ${itemProcessingResults.processed} items added, ${itemProcessingResults.skipped} skipped, ${itemProcessingResults.errors.length} errors`);
        
      } catch (error) {
        console.error('❌ Error saving transactions to database:', error);
      }
    } else {
      console.log('⚠️  No valid transactions to save to database');
    }
    
    res.json({
      message: 'Transaction report retrieved and processed successfully',
      data: report,
      transactions: transactions,
      validTransactions: validTransactions,
      databaseResults: dbResults,
      donorResults: donorResults,
      itemResults: itemProcessingResults,
      params: queryParams
    });
  } catch (error) {
    console.error('Error fetching transaction report:', error);
    res.status(500).json({ error: 'Failed to fetch transaction report: ' + error.message });
  }
});

// ===== RECEIPT GENERATION ENDPOINTS =====

// Generate receipt for a transaction
app.post('/api/receipts/generate/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    
    console.log(`🔄 Generating receipt for transaction ${transactionId}`);
    
    const receipt = await receiptGenerator.generateReceiptForTransaction(transactionId, db, req);
    
    res.json({
      message: 'Receipt generated successfully',
      receipt: receipt
    });
    
  } catch (error) {
    console.error('❌ Error generating receipt:', error);
    res.status(500).json({ error: 'Failed to generate receipt: ' + error.message });
  }
});

// Check if receipt exists for a transaction (without generating)
app.get('/api/receipts/check/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    
    console.log(`🔍 Checking if receipt exists for transaction ${transactionId}`);
    
    const receipt = await db.getReceiptByTransactionId(transactionId);
    
    if (receipt) {
      res.json({
        exists: true,
        receipt: {
          id: receipt.id,
          transaction_id: receipt.transaction_id,
          receipt_number: receipt.receipt_number,
          created_at: receipt.created_at
        }
      });
    } else {
      res.json({
        exists: false,
        message: 'No receipt found for this transaction'
      });
    }
    
  } catch (error) {
    console.error('❌ Error checking receipt:', error);
    res.status(500).json({ error: 'Failed to check receipt: ' + error.message });
  }
});

// Serve receipt PDF for inline viewing
app.get('/receipts/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    
    // Find receipt by transaction ID
    const receipt = await db.getReceiptByTransactionId(transactionId);
    
    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }
    
    // Set response headers for inline PDF viewing
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${receipt.receipt_filename}"`);
    res.setHeader('Content-Length', receipt.receipt_blob.length);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); // Prevent caching
    
    // Send the PDF blob
    res.send(receipt.receipt_blob);
    
  } catch (error) {
    console.error('❌ Error serving receipt from database:', error);
    res.status(500).json({ error: 'Failed to serve receipt' });
  }
});

// Generate receipts for all transactions without receipts
app.post('/api/receipts/generate-all', async (req, res) => {
  try {
    console.log('🔄 Generating receipts for all transactions without receipts');
    
    const transactions = await db.getAllTransactions();
    const results = {
      generated: 0,
      skipped: 0,
      errors: []
    };
    
    for (const transaction of transactions) {
      try {
        // Check if receipt already exists for this transaction
        const existingReceipt = await db.getReceiptByTransactionId(transaction.id);
        if (existingReceipt) {
          results.skipped++;
          continue;
        }
        
        // Generate receipt
        const receiptResult = await receiptGenerator.generateReceiptForTransaction(transaction.id, db, req);
        
        if (receiptResult.action === 'created') {
          results.generated++;
        } else {
          results.skipped++;
        }
        
      } catch (error) {
        console.error(`❌ Error generating receipt for transaction ${transaction.id}:`, error);
        results.errors.push({
          transactionId: transaction.id,
          error: error.message
        });
      }
    }
    
    res.json({
      message: 'Receipt generation completed',
      results: results
    });
    
  } catch (error) {
    console.error('❌ Error generating receipts for all transactions:', error);
    res.status(500).json({ error: 'Failed to generate receipts: ' + error.message });
  }
});

// ===== ORGANIZATION API ENDPOINTS =====

// Get all organizations
app.get('/api/organizations', async (req, res) => {
  try {
    console.log('🔍 Fetching organizations from database...');
    const organizations = await db.getAllOrganizations();
    console.log('📊 Found organizations:', organizations.length);
    console.log('📋 Organizations data:', organizations);
    res.json(organizations);
  } catch (error) {
    console.error('❌ Error fetching organizations:', error);
    res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

// Get current organization (based on realmId cookie)
app.get('/api/organizations/current', async (req, res) => {
  try {
    const realmId = req.cookies.quickbooks_realmId;
    console.log('🔍 Getting current organization for realmId:', realmId);
    
    if (!realmId) {
      return res.status(400).json({ error: 'No QuickBooks connection found' });
    }
    
    const organization = await db.getOrganizationByQbId(realmId);
    
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found for this QuickBooks connection' });
    }
    
    console.log('✅ Found current organization:', organization.name, '(ID:', organization.id + ')');
    res.json(organization);
  } catch (error) {
    console.error('❌ Error fetching current organization:', error);
    res.status(500).json({ error: 'Failed to fetch current organization' });
  }
});

// Add new organization
app.post('/api/organizations', async (req, res) => {
  try {
    const { name, ein, address, city, state, zip, email, phone, contact, type, url } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Organization name is required' });
    }
    
    const newOrganization = await db.addOrganization({ name, ein, address, city, state, zip, email, phone, contact, type, url });
    res.status(201).json(newOrganization);
  } catch (error) {
    console.error('Error adding organization:', error);
    res.status(500).json({ error: 'Failed to add organization' });
  }
});

// Update organization
app.put('/api/organizations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, ein, address, city, state, zip, email, phone, contact, type, url } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Organization name is required' });
    }
    
    const updatedOrganization = await db.updateOrganization(id, { name, ein, address, city, state, zip, email, phone, contact, type, url });
    res.json(updatedOrganization);
  } catch (error) {
    console.error('Error updating organization:', error);
    res.status(500).json({ error: 'Failed to update organization' });
  }
});

// Delete organization
app.delete('/api/organizations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.deleteOrganization(id);
    
    if (result.deleted) {
      res.json({ message: 'Organization deleted successfully' });
    } else {
      res.status(404).json({ error: 'Organization not found' });
    }
  } catch (error) {
    console.error('Error deleting organization:', error);
    res.status(500).json({ error: 'Failed to delete organization' });
  }
});

// Get organization by ID
app.get('/api/organizations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const organization = await db.getOrganizationById(id);
    
    if (organization) {
      res.json(organization);
    } else {
      res.status(404).json({ error: 'Organization not found' });
    }
  } catch (error) {
    console.error('Error fetching organization:', error);
    res.status(500).json({ error: 'Failed to fetch organization' });
  }
});

// Get organization by EIN
app.get('/api/organizations/ein/:ein', async (req, res) => {
  try {
    const { ein } = req.params;
    const organization = await db.getOrganizationByEin(ein);
    
    if (organization) {
      res.json(organization);
    } else {
      res.status(404).json({ error: 'Organization not found' });
    }
  } catch (error) {
    console.error('Error fetching organization by EIN:', error);
    res.status(500).json({ error: 'Failed to fetch organization' });
  }
});

// ===== LOGO API ENDPOINTS =====

// Get logo for current organization
app.get('/api/logos', async (req, res) => {
  try {
    // Debug: Log all cookies
    console.log('🍪 All cookies:', req.cookies);
    console.log('🍪 Cookie names:', Object.keys(req.cookies || {}));
    
    // Get realmId from cookie
    const realmId = req.cookies.quickbooks_realmId;
    console.log('🔍 RealmId from cookie:', realmId);
    
    if (!realmId) {
      return res.status(400).json({ 
        error: 'No QuickBooks connection found',
        availableCookies: Object.keys(req.cookies || {}),
        allCookies: req.cookies
      });
    }
    
    // Get organization by realmId
    const organization = await db.getOrganizationByQbId(realmId);
    
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    
    // Get logo for this organization
    const logo = await db.getLogoByOrganizationId(organization.id);
    
    if (logo && logo.Logo && logo.logofilename) {
      // Convert BLOB data to proper format for JSON response
      let logoArray = null;
      if (logo.Logo && Buffer.isBuffer(logo.Logo)) {
        logoArray = Array.from(logo.Logo);
      } else if (logo.Logo && typeof logo.Logo === 'object') {
        logoArray = Array.from(new Uint8Array(logo.Logo));
      }
      
      const logoResponse = {
        LogoId: logo.LogoId,
        Logo: logoArray,
        logofilename: logo.logofilename,
        logoposition: logo.logoposition,
        width: logo.width,
        height: logo.height,
        organizationId: logo.organizationId,
        created_at: logo.created_at,
        updated_at: logo.updated_at
      };
      res.json(logoResponse);
    } else {
      res.status(404).json({ error: 'No logo found for this organization' });
    }
  } catch (error) {
    console.error('Error fetching logo:', error);
    res.status(500).json({ error: 'Failed to fetch logo' });
  }
});

// Add or update logo for current organization
app.post('/api/logos', async (req, res) => {
  try {
    // Enhanced debugging
    console.log('🍪 POST /api/logos - All cookies:', req.cookies);
    console.log('🍪 POST /api/logos - Cookie names:', Object.keys(req.cookies || {}));
    console.log('📦 POST /api/logos - Request body keys:', Object.keys(req.body || {}));
    console.log('📦 POST /api/logos - Logo data present:', !!req.body.Logo);
    console.log('📦 POST /api/logos - Logo array length:', req.body.Logo ? req.body.Logo.length : 'N/A');
    
    // Get realmId from cookie
    const realmId = req.cookies.quickbooks_realmId;
    console.log('🔍 POST /api/logos - RealmId from cookie:', realmId);
    
    if (!realmId) {
      return res.status(400).json({ 
        error: 'No QuickBooks connection found',
        availableCookies: Object.keys(req.cookies || {}),
        allCookies: req.cookies
      });
    }
    
    // Get organization by realmId
    console.log('🔍 POST /api/logos - Looking up organization with realmId:', realmId);
    const organization = await db.getOrganizationByQbId(realmId);
    console.log('🏢 POST /api/logos - Found organization:', organization ? `ID: ${organization.id}, Name: ${organization.name}` : 'NOT FOUND');
    
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    
    const { Logo, logofilename, logoposition, width, height } = req.body;
    
    // Server-side validation
    const validationErrors = [];
    
    // Validate logo data if provided
    if (Logo && Array.isArray(Logo)) {
      const logoSize = Logo.length;
      const maxSize = 5 * 1024 * 1024; // 5MB in bytes
      
      console.log(`📏 POST /api/logos - Logo size validation: ${logoSize} bytes (${Math.round(logoSize / 1024 * 100) / 100}KB)`);
      
      if (logoSize > maxSize) {
        validationErrors.push(`Logo file size (${Math.round(logoSize / 1024 / 1024 * 100) / 100}MB) exceeds maximum allowed size of 5MB`);
      }
      
      if (logoSize === 0) {
        validationErrors.push('Logo file appears to be empty');
      }
    }
    
    // Validate filename
    if (logofilename) {
      if (logofilename.length > 255) {
        validationErrors.push('Logo filename is too long (maximum 255 characters)');
      }
      
      // Check for suspicious characters
      const suspiciousPatterns = /[<>:"/\\|?*\x00-\x1f]/;
      if (suspiciousPatterns.test(logofilename)) {
        validationErrors.push('Logo filename contains invalid characters');
      }
    }
    
    // Validate dimensions
    if (width && (width < 1 || width > 2048)) {
      validationErrors.push('Logo width must be between 1 and 2048 pixels');
    }
    
    if (height && (height < 1 || height > 2048)) {
      validationErrors.push('Logo height must be between 1 and 2048 pixels');
    }
    
    // Validate position
    const validPositions = ['top-left', 'top-center', 'top-right'];
    if (logoposition && !validPositions.includes(logoposition)) {
      validationErrors.push(`Invalid logo position. Must be one of: ${validPositions.join(', ')}`);
    }
    
    // Return validation errors if any
    if (validationErrors.length > 0) {
      return res.status(400).json({ 
        error: 'Validation failed',
        details: validationErrors
      });
    }
    
    // Check if logo already exists for this organization
    console.log('🔍 POST /api/logos - Checking for existing logo for organization ID:', organization.id);
    const existingLogo = await db.getLogoByOrganizationId(organization.id);
    console.log('🖼️ POST /api/logos - Existing logo found:', !!existingLogo);
    
    let result;
    if (existingLogo) {
      // Update existing logo
      console.log('🔄 POST /api/logos - Updating existing logo ID:', existingLogo.LogoId);
      try {
        result = await Promise.race([
          db.updateLogo(existingLogo.LogoId, {
            Logo,
            logofilename,
            logoposition,
            width,
            height,
            organizationId: organization.id
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Database operation timeout')), 30000))
        ]);
        console.log('✅ POST /api/logos - Logo updated successfully');
      } catch (dbError) {
        console.error('❌ POST /api/logos - Database update error:', dbError);
        throw dbError;
      }
    } else {
      // Create new logo
      console.log('➕ POST /api/logos - Creating new logo for organization ID:', organization.id);
      try {
        result = await Promise.race([
          db.addLogo({
            Logo,
            logofilename,
            logoposition,
            width,
            height,
            organizationId: organization.id
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Database operation timeout')), 30000))
        ]);
        console.log('✅ POST /api/logos - Logo created successfully, ID:', result.LogoId);
      } catch (dbError) {
        console.error('❌ POST /api/logos - Database create error:', dbError);
        throw dbError;
      }
    }
    
    res.status(201).json(result);
  } catch (error) {
    console.error('❌ POST /api/logos - Error saving logo:', error);
    console.error('❌ POST /api/logos - Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to save logo',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Delete logo for current organization
app.delete('/api/logos', async (req, res) => {
  try {
    // Get realmId from cookie
    const realmId = req.cookies.quickbooks_realmId;
    
    if (!realmId) {
      return res.status(400).json({ error: 'No QuickBooks connection found' });
    }
    
    // Get organization by realmId
    const organization = await db.getOrganizationByQbId(realmId);
    
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    
    // Delete logo for this organization
    const result = await db.deleteLogoByOrganizationId(organization.id);
    
    if (result.deleted) {
      res.json({ message: 'Logo deleted successfully' });
    } else {
      res.status(404).json({ error: 'No logo found to delete' });
    }
  } catch (error) {
    console.error('Error deleting logo:', error);
    res.status(500).json({ error: 'Failed to delete logo' });
  }
});

// ===== TEMPLATE MANAGEMENT API ENDPOINTS =====

// Get template configuration
app.get('/api/template', async (req, res) => {
  try {
    const templateData = templateManager.getTemplateData();
    res.json(templateData);
  } catch (error) {
    console.error('Error fetching template config:', error);
    res.status(500).json({ error: 'Failed to fetch template configuration' });
  }
});

// Update organization information
app.put('/api/template/organization', async (req, res) => {
  try {
    const updatedOrg = templateManager.updateOrganization(req.body);
    res.json({ success: true, organization: updatedOrg });
  } catch (error) {
    console.error('Error updating organization:', error);
    res.status(500).json({ error: 'Failed to update organization information' });
  }
});

// Update receipt settings
app.put('/api/template/receipt', async (req, res) => {
  try {
    const updatedReceipt = templateManager.updateReceiptSettings(req.body);
    res.json({ success: true, receipt: updatedReceipt });
  } catch (error) {
    console.error('Error updating receipt settings:', error);
    res.status(500).json({ error: 'Failed to update receipt settings' });
  }
});

// Update branding settings
app.put('/api/template/branding', async (req, res) => {
  try {
    const updatedBranding = templateManager.updateBranding(req.body);
    res.json({ success: true, branding: updatedBranding });
  } catch (error) {
    console.error('Error updating branding settings:', error);
    res.status(500).json({ error: 'Failed to update branding settings' });
  }
});

// Upload logo
app.post('/api/template/logo', upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const result = templateManager.uploadLogo(req.file.buffer, req.file.originalname);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error uploading logo:', error);
    res.status(500).json({ error: error.message || 'Failed to upload logo' });
  }
});

// Delete logo
app.delete('/api/template/logo', async (req, res) => {
  try {
    const result = templateManager.deleteLogo();
    res.json(result);
  } catch (error) {
    console.error('Error deleting logo:', error);
    res.status(500).json({ error: 'Failed to delete logo' });
  }
});

// Get logo file
app.get('/api/template/logo', async (req, res) => {
  try {
    const logoPath = templateManager.getLogoPath();
    if (!logoPath) {
      return res.status(404).json({ error: 'No logo found' });
    }
    
    res.sendFile(logoPath);
  } catch (error) {
    console.error('Error serving logo:', error);
    res.status(500).json({ error: 'Failed to serve logo' });
  }
});

// ===== QUICKBOOKS INTEGRATION ENDPOINTS =====

// Process QuickBooks SalesReceipt data and populate transaction items
app.post('/api/quickbooks/process-salesreceipts', async (req, res) => {
  try {
    const { salesReceipts } = req.body;
    
    if (!salesReceipts || !Array.isArray(salesReceipts)) {
      return res.status(400).json({ error: 'salesReceipts array is required' });
    }
    
    console.log(`🔄 Processing ${salesReceipts.length} QuickBooks SalesReceipts...`);
    
    const result = await db.populateTransactionItemsFromMultipleQuickbooks(salesReceipts);
    
    res.json({
      message: 'QuickBooks SalesReceipts processed successfully',
      result: result
    });
    
  } catch (error) {
    console.error('❌ Error processing QuickBooks SalesReceipts:', error);
    res.status(500).json({ error: 'Failed to process SalesReceipts: ' + error.message });
  }
});

// Process a single QuickBooks SalesReceipt
app.post('/api/quickbooks/process-salesreceipt/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { salesReceipt } = req.body;
    
    if (!salesReceipt) {
      return res.status(400).json({ error: 'salesReceipt data is required' });
    }
    
    console.log(`🔄 Processing QuickBooks SalesReceipt for transaction ${transactionId}...`);
    
    const result = await db.populateTransactionItemsFromQuickbooks(salesReceipt, transactionId);
    
    res.json({
      message: 'QuickBooks SalesReceipt processed successfully',
      result: result
    });
    
  } catch (error) {
    console.error('❌ Error processing QuickBooks SalesReceipt:', error);
    res.status(500).json({ error: 'Failed to process SalesReceipt: ' + error.message });
  }
});

// ===== TRANSACTION ITEMS API ENDPOINTS =====

// Get all transaction items
app.get('/api/transaction-items', async (req, res) => {
  try {
    const items = await db.getAllTransactionItems();
    res.json(items);
  } catch (error) {
    console.error('Error fetching transaction items:', error);
    res.status(500).json({ error: 'Failed to fetch transaction items' });
  }
});

// Get transaction items by transaction ID
app.get('/api/transaction-items/transaction/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    const items = await db.getTransactionItemsByTransactionId(transactionId);
    res.json(items);
  } catch (error) {
    console.error('Error fetching transaction items by transaction ID:', error);
    res.status(500).json({ error: 'Failed to fetch transaction items' });
  }
});

// Get transaction item by ID
app.get('/api/transaction-items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const item = await db.getTransactionItemById(id);
    
    if (item) {
      res.json(item);
    } else {
      res.status(404).json({ error: 'Transaction item not found' });
    }
  } catch (error) {
    console.error('Error fetching transaction item:', error);
    res.status(500).json({ error: 'Failed to fetch transaction item' });
  }
});

// Add new transaction item
app.post('/api/transaction-items', async (req, res) => {
  try {
    const { description, quantity, transactionId, amount, lineNum, unitPrice } = req.body;
    
    if (!description || !transactionId || !amount) {
      return res.status(400).json({ error: 'Description, transactionId, and amount are required' });
    }
    
    const newItem = await db.addTransactionItem({ description, quantity, transactionId, amount, lineNum, unitPrice });
    res.status(201).json(newItem);
  } catch (error) {
    console.error('Error adding transaction item:', error);
    res.status(500).json({ error: 'Failed to add transaction item' });
  }
});

// Update transaction item
app.put('/api/transaction-items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { description, quantity, amount, lineNum, unitPrice } = req.body;
    
    console.log('📥 PUT /api/transaction-items/:id - Request data:', {
      id,
      description,
      quantity,
      amount,
      lineNum,
      unitPrice
    });
    
    // Check if this is a partial update (only description changed)
    const isPartialUpdate = description && 
                           quantity !== undefined && 
                           amount !== undefined &&
                           (quantity === null || typeof quantity === 'number') &&
                           (amount === null || typeof amount === 'number' || typeof amount === 'string');
    
    if (isPartialUpdate) {
      // Allow partial update with existing values
      console.log('✅ Processing as partial/full update');
      
      if (!description) {
        return res.status(400).json({ error: 'Description is required' });
      }
      
      if (amount === null || amount === undefined) {
        return res.status(400).json({ error: 'Amount is required' });
      }
      
      const updatedItem = await db.updateTransactionItem(id, { 
        description, 
        quantity: quantity || 1, 
        amount, 
        lineNum, 
        unitPrice 
      });
      res.json(updatedItem);
    } else {
      // Old format: only description provided, need to fetch existing item
      console.log('🔄 Processing as description-only update, fetching existing item');
      const existingItem = await db.getTransactionItemById(id);
      if (!existingItem) {
        return res.status(404).json({ error: 'Transaction item not found' });
      }
      
      const updatedItem = await db.updateTransactionItem(id, {
        description: description || existingItem.description,
        quantity: existingItem.quantity,
        amount: existingItem.amount,
        lineNum: existingItem.lineNum,
        unitPrice: existingItem.unitPrice
      });
      res.json(updatedItem);
    }
  } catch (error) {
    console.error('❌ Error updating transaction item:', error);
    res.status(500).json({ error: 'Failed to update transaction item' });
  }
});

// Delete transaction item
app.delete('/api/transaction-items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.deleteTransactionItem(id);
    
    if (result.deleted) {
      res.json({ message: 'Transaction item deleted successfully' });
    } else {
      res.status(404).json({ error: 'Transaction item not found' });
    }
  } catch (error) {
    console.error('Error deleting transaction item:', error);
    res.status(500).json({ error: 'Failed to delete transaction item' });
  }
});

// Delete all transaction items for a transaction
app.delete('/api/transaction-items/transaction/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    const result = await db.deleteTransactionItemsByTransactionId(transactionId);
    
    res.json({ 
      message: 'Transaction items deleted successfully',
      deletedCount: result.count
    });
  } catch (error) {
    console.error('Error deleting transaction items:', error);
    res.status(500).json({ error: 'Failed to delete transaction items' });
  }
});

// ===== RECEIPT MANAGEMENT ENDPOINTS =====

// Get all receipts
app.get('/api/receipts', async (req, res) => {
  try {
    const receipts = await db.getAllReceipts();
    res.json(receipts);
  } catch (error) {
    console.error('Error fetching receipts:', error);
    res.status(500).json({ error: 'Failed to fetch receipts' });
  }
});

// Get receipt by ID
app.get('/api/receipts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const receipt = await db.getReceiptById(id);
    
    if (receipt) {
      res.json(receipt);
    } else {
      res.status(404).json({ error: 'Receipt not found' });
    }
  } catch (error) {
    console.error('Error fetching receipt:', error);
    res.status(500).json({ error: 'Failed to fetch receipt' });
  }
});

// Get receipts by donor ID
app.get('/api/receipts/donor/:donorId', async (req, res) => {
  try {
    const { donorId } = req.params;
    const receipts = await db.getReceiptsByDonorId(donorId);
    res.json(receipts);
  } catch (error) {
    console.error('Error fetching donor receipts:', error);
    res.status(500).json({ error: 'Failed to fetch donor receipts' });
  }
});

// Update receipt sent date
app.put('/api/receipts/:id/sent', async (req, res) => {
  try {
    const { id } = req.params;
    const { datesent } = req.body;
    
    const updatedReceipt = await db.updateReceiptSentDate(id, datesent);
    res.json(updatedReceipt);
  } catch (error) {
    console.error('Error updating receipt sent date:', error);
    res.status(500).json({ error: 'Failed to update receipt sent date' });
  }
});

// Delete receipt
app.delete('/api/receipts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.deleteReceipt(id);
    
    if (result.deleted) {
      res.json({ message: 'Receipt deleted successfully' });
    } else {
      res.status(404).json({ error: 'Receipt not found' });
    }
  } catch (error) {
    console.error('Error deleting receipt:', error);
    res.status(500).json({ error: 'Failed to delete receipt' });
  }
});

// Email receipt endpoint
app.post('/api/receipts/email', async (req, res) => {
  try {
    const { transactionId, email, subject, message } = req.body;
    
    if (!transactionId || !email) {
      return res.status(400).json({ error: 'Transaction ID and email are required' });
    }
    
    console.log(`📧 Sending receipt email for transaction ${transactionId} to ${email}`);
    
    // Get the receipt data
    const receipt = await db.getReceiptByTransactionId(transactionId);
    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }
    
             console.log('📄 Email - Receipt data keys:', Object.keys(receipt));
             console.log('📄 Email - PDF data type:', typeof receipt.receipt_blob);
             console.log('📄 Email - PDF data length:', receipt.receipt_blob ? receipt.receipt_blob.length : 'undefined');
    
    // Get transaction and donor information
    const transaction = await db.getTransactionById(transactionId);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    console.log('🔍 Email - Transaction found:', {
      id: transaction.id,
      donorId: transaction.donor_id,
      amount: transaction.amount
    });
    
    let donor = await db.getDonorById(transaction.donor_id);
    console.log('🔍 Email - Donor lookup result:', donor ? 'Found' : 'Not found', transaction.donor_id);
    
    if (!donor) {
      console.log('❌ Email - Donor not found, transaction.donorId:', transaction.donorId);
      console.log('🔍 Email - Transaction details:', transaction);
      
      // Create a fallback donor object using the email address
      console.log('📧 Email - Creating fallback donor object for email:', email);
      donor = {
        name: 'Donor',
        email: email,
        address: '',
        city: '',
        state: '',
        zip: ''
      };
    }
    
    // Get organization information
    const realmId = req.cookies.quickbooks_realmId;
    const organization = realmId ? await db.getOrganizationByQbId(realmId) : null;
    
    if (!organization) {
      const allOrgs = await db.getAllOrganizations();
      if (allOrgs.length > 0) {
        organization = allOrgs[0];
      }
    }
    
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    
    // Get email settings and create transporter
    const transporter = await createTransporterFromSettings(organization.id) || emailTransporter;
    
    // Get from email address from settings or use default
    const useCustomOption = await db.getOption(organization.id, 'EMAIL_USE_CUSTOM').then(opt => opt ? opt.value : null).catch(() => null);
    const useCustom = useCustomOption === 'true';
    
    let emailFrom;
    if (useCustom) {
      const emailFromOption = await db.getOption(organization.id, 'EMAIL_FROM').then(opt => opt ? opt.value : null).catch(() => null);
      emailFrom = emailFromOption || process.env.EMAIL_FROM || process.env.EMAIL_USER || 'noreply@donationapp.com';
    } else {
      emailFrom = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'noreply@donationapp.com';
    }
    
    // Create email content
    const userMessage = (message && message.trim()) ? message.trim() : '';
    const emailContent = {
      to: email,
      subject: subject || 'Your Donation Receipt',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Thank you for your donation!</h2>
          <p>Dear ${donor.name},</p>
          ${userMessage ? `<p>${userMessage.replace(/\n/g, '<br>')}</p>` : ''}
          <p>Please find your receipt attached to this email.</p>
          <p>Best regards,<br>
          ${organization.contact || 'Primary Contact'}<br>
          ${organization.name}<br>
          ${organization.phone || 'Phone Number'}</p>
        </div>
      `,
      attachments: [
        {
          filename: `receipt_${transactionId}.pdf`,
          content: receipt.receipt_blob || receipt.pdfData || receipt.receiptData || receipt.data,
          contentType: 'application/pdf'
        }
      ]
    };
    
    // Send email using the configured transporter
    const mailOptions = {
      from: emailFrom,
      to: emailContent.to,
      subject: emailContent.subject,
      html: emailContent.html,
      attachments: emailContent.attachments
    };
    
    await transporter.sendMail(mailOptions);
    console.log('📧 Email sent successfully to:', emailContent.to);
    
    // Update receipt as sent
    await db.updateReceiptSentDate(receipt.id, new Date().toISOString());
    
    res.json({ 
      message: 'Receipt email sent successfully',
      emailSent: true 
    });
    
  } catch (error) {
    console.error('❌ Error sending receipt email:', error);
    res.status(500).json({ error: 'Failed to send email: ' + error.message });
  }
});

// ===== FEEDBACK API ENDPOINTS =====

// Get all feedback
app.get('/api/feedback', async (req, res) => {
  try {
    const feedback = await db.getAllFeedback();
    res.json(feedback);
  } catch (error) {
    console.error('Error fetching feedback:', error);
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
});

// Get feedback by organization ID
app.get('/api/feedback/organization/:organizationId', async (req, res) => {
  try {
    const { organizationId } = req.params;
    const feedback = await db.getFeedbackByOrganizationId(organizationId);
    res.json(feedback);
  } catch (error) {
    console.error('Error fetching feedback:', error);
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
});

// Submit new feedback
app.post('/api/feedback', async (req, res) => {
  try {
    const { feedback, email, rating, organizationId } = req.body;
    
    // Validate required fields
    if (!feedback || !rating) {
      return res.status(400).json({ error: 'Feedback and rating are required' });
    }
    
    // Validate rating is between 1 and 10
    if (rating < 1 || rating > 10) {
      return res.status(400).json({ error: 'Rating must be between 1 and 10' });
    }
    
    const feedbackData = {
      feedback,
      email: email || null,
      rating,
      organizationId: organizationId || null
    };
    
    const newFeedback = await db.addFeedback(feedbackData);
    console.log(`✅ Feedback submitted: Rating ${rating}/10`);
    
    res.status(201).json({
      message: 'Feedback submitted successfully',
      feedback: newFeedback
    });
  } catch (error) {
    console.error('Error submitting feedback:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// Delete feedback (admin only - you may want to add authentication)
app.delete('/api/feedback/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.deleteFeedback(id);
    
    if (result.deleted) {
      res.json({ message: 'Feedback deleted successfully' });
    } else {
      res.status(404).json({ error: 'Feedback not found' });
    }
  } catch (error) {
    console.error('Error deleting feedback:', error);
    res.status(500).json({ error: 'Failed to delete feedback' });
  }
});


// ===== EMAIL SETTINGS API ROUTES =====

// Get email settings for current organization
app.get('/api/email/settings', async (req, res) => {
  try {
    const realmId = req.cookies.quickbooks_realmId;
    
    if (!realmId) {
      return res.status(400).json({ error: 'No QuickBooks connection found' });
    }
    
    const organization = await db.getOrganizationByQbId(realmId);
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    
    // Check if custom email is enabled (default to false if not set)
    const useCustomOption = await db.getOption(organization.id, 'EMAIL_USE_CUSTOM').then(opt => opt ? opt.value : null).catch(() => null);
    const useCustom = useCustomOption === 'true';
    
    // Get all email settings from options
    const emailSettings = {
      useCustom: useCustom,
      from: await db.getOption(organization.id, 'EMAIL_FROM').then(opt => opt ? opt.value : null).catch(() => null),
      host: await db.getOption(organization.id, 'EMAIL_HOST').then(opt => opt ? opt.value : null).catch(() => null),
      port: await db.getOption(organization.id, 'EMAIL_PORT').then(opt => opt ? opt.value : null).catch(() => null),
      secure: await db.getOption(organization.id, 'EMAIL_SECURE').then(opt => opt ? opt.value : 'false').catch(() => 'false'),
      user: await db.getOption(organization.id, 'EMAIL_USER').then(opt => opt ? opt.value : null).catch(() => null),
      // Don't return password, just indicate if it's set
      hasPassword: await db.getOption(organization.id, 'EMAIL_PASS').then(opt => !!opt).catch(() => false)
    };
    
    // If custom email is not enabled, return environment variables
    if (!useCustom) {
      emailSettings.from = process.env.EMAIL_FROM || process.env.EMAIL_USER || '';
      emailSettings.host = process.env.EMAIL_HOST || 'smtp.gmail.com';
      emailSettings.port = process.env.EMAIL_PORT || '587';
      emailSettings.secure = process.env.EMAIL_SECURE === 'true' ? 'true' : 'false';
      emailSettings.user = process.env.EMAIL_USER || '';
      emailSettings.hasPassword = !!(process.env.EMAIL_PASS);
    } else {
      // Use environment variables as defaults if not set in database
      emailSettings.from = emailSettings.from || process.env.EMAIL_FROM || process.env.EMAIL_USER || '';
      emailSettings.host = emailSettings.host || process.env.EMAIL_HOST || 'smtp.gmail.com';
      emailSettings.port = emailSettings.port || process.env.EMAIL_PORT || '587';
      emailSettings.secure = emailSettings.secure || (process.env.EMAIL_SECURE === 'true' ? 'true' : 'false');
      emailSettings.user = emailSettings.user || process.env.EMAIL_USER || '';
    }
    
    res.json(emailSettings);
  } catch (error) {
    console.error('Error fetching email settings:', error);
    res.status(500).json({ error: 'Failed to fetch email settings' });
  }
});

// Save email settings for current organization
app.post('/api/email/settings', async (req, res) => {
  try {
    const realmId = req.cookies.quickbooks_realmId;
    
    if (!realmId) {
      return res.status(400).json({ error: 'No QuickBooks connection found' });
    }
    
    const organization = await db.getOrganizationByQbId(realmId);
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    
    const { useCustom, from, host, port, secure, user, pass } = req.body;
    
    // Save the useCustom flag
    await db.setOption(organization.id, 'EMAIL_USE_CUSTOM', useCustom ? 'true' : 'false');
    
    // If custom email is enabled, save custom settings
    if (useCustom) {
      // Validate required fields
      if (!from || !host || !port || !user) {
        return res.status(400).json({ error: 'From email, host, port, and username are required' });
      }
      
      // Validate port is a number
      const portNum = parseInt(port);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        return res.status(400).json({ error: 'Port must be a number between 1 and 65535' });
      }
      
      // Import encryption for password
      const Encryption = require('./encryption');
      
      // Save email settings
      await db.setOption(organization.id, 'EMAIL_FROM', from);
      await db.setOption(organization.id, 'EMAIL_HOST', host);
      await db.setOption(organization.id, 'EMAIL_PORT', port.toString());
      await db.setOption(organization.id, 'EMAIL_SECURE', secure ? 'true' : 'false');
      await db.setOption(organization.id, 'EMAIL_USER', user);
      
      // Only update password if provided
      if (pass && pass.trim() !== '') {
        // Encrypt password before storing
        const encryptedPassword = Encryption.encrypt(pass);
        await db.setOption(organization.id, 'EMAIL_PASS', encryptedPassword);
      }
      
      // Update nodemailer transporter with new settings
      updateEmailTransporter(organization.id);
    } else {
      // If custom email is disabled, use environment variables
      // Don't delete the custom settings, just ignore them
      // This allows users to switch back to custom settings later
    }
    
    res.json({ 
      message: useCustom ? 'Custom email settings saved successfully' : 'Now using default email settings from environment variables',
      settings: {
        useCustom: useCustom,
        from: useCustom ? from : (process.env.EMAIL_FROM || process.env.EMAIL_USER || ''),
        host: useCustom ? host : (process.env.EMAIL_HOST || 'smtp.gmail.com'),
        port: useCustom ? port : (process.env.EMAIL_PORT || '587'),
        secure: useCustom ? secure : (process.env.EMAIL_SECURE === 'true'),
        user: useCustom ? user : (process.env.EMAIL_USER || ''),
        hasPassword: useCustom ? !!(pass && pass.trim() !== '') : !!(process.env.EMAIL_PASS)
      }
    });
  } catch (error) {
    console.error('Error saving email settings:', error);
    res.status(500).json({ error: 'Failed to save email settings: ' + error.message });
  }
});

// Test email connection
app.post('/api/email/test', async (req, res) => {
  try {
    const realmId = req.cookies.quickbooks_realmId;
    
    if (!realmId) {
      return res.status(400).json({ error: 'No QuickBooks connection found' });
    }
    
    const organization = await db.getOrganizationByQbId(realmId);
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    
    // Create a test transporter with current settings
    const testTransporter = await createTransporterFromSettings(organization.id);
    
    if (!testTransporter) {
      return res.status(400).json({ error: 'Email settings not configured' });
    }
    
    // Verify connection
    testTransporter.verify((error, success) => {
      if (error) {
        console.error('Email connection test failed:', error);
        res.status(400).json({ 
          success: false,
          error: 'Connection test failed',
          message: error.message 
        });
      } else {
        console.log('✅ Email connection test successful');
        res.json({ 
          success: true,
          message: 'Email connection test successful'
        });
      }
    });
  } catch (error) {
    console.error('Error testing email connection:', error);
    res.status(500).json({ error: 'Failed to test email connection: ' + error.message });
  }
});

// Helper function to create transporter from database settings
async function createTransporterFromSettings(organizationId) {
  try {
    // Check if custom email is enabled
    const useCustomOption = await db.getOption(organizationId, 'EMAIL_USE_CUSTOM').then(opt => opt ? opt.value : null).catch(() => null);
    const useCustom = useCustomOption === 'true';

    const Encryption = require('./encryption');
    let emailSettings;

    if (useCustom) {
      // Use custom settings from database
      emailSettings = {
        from: await db.getOption(organizationId, 'EMAIL_FROM').then(opt => opt ? opt.value : null).catch(() => null),
        host: await db.getOption(organizationId, 'EMAIL_HOST').then(opt => opt ? opt.value : null).catch(() => null),
        port: await db.getOption(organizationId, 'EMAIL_PORT').then(opt => opt ? opt.value : null).catch(() => null),
        secure: await db.getOption(organizationId, 'EMAIL_SECURE').then(opt => opt ? opt.value : 'false').catch(() => 'false'),
        user: await db.getOption(organizationId, 'EMAIL_USER').then(opt => opt ? opt.value : null).catch(() => null),
        pass: await db.getOption(organizationId, 'EMAIL_PASS').then(opt => opt ? Encryption.decrypt(opt.value) : null).catch(() => null)
      };

      // Use environment variables as fallback if not set in database
      emailSettings.from = emailSettings.from || process.env.EMAIL_FROM || process.env.EMAIL_USER || '';
      emailSettings.host = emailSettings.host || process.env.EMAIL_HOST || 'smtp.gmail.com';
      emailSettings.port = emailSettings.port || process.env.EMAIL_PORT || 587;
      emailSettings.secure = emailSettings.secure === 'true' || process.env.EMAIL_SECURE === 'true';
      emailSettings.user = emailSettings.user || process.env.EMAIL_USER || '';
      emailSettings.pass = emailSettings.pass || process.env.EMAIL_PASS || '';

      // Log masked config
      logEmailConfig(`CUSTOM(org:${organizationId})`, emailSettings);
    } else {
      // Use environment variables directly
      emailSettings = {
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER || '',
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: process.env.EMAIL_PORT || 587,
        secure: process.env.EMAIL_SECURE === 'true',
        user: process.env.EMAIL_USER || '',
        pass: process.env.EMAIL_PASS || ''
      };

      // Log masked config
      logEmailConfig('ENV(fallback)', emailSettings);
    }

    if (!emailSettings.host || !emailSettings.user || !emailSettings.pass) {
      console.log('⚠️  Incomplete email settings; transporter will not be created.');
      return null;
    }

    return nodemailer.createTransport({
      host: emailSettings.host,
      port: parseInt(emailSettings.port),
      secure: emailSettings.secure,
      auth: {
        user: emailSettings.user,
        pass: emailSettings.pass
      }
    });
  } catch (error) {
    console.error('Error creating transporter from settings:', error);
    return null;
  }
}

// Helper function to update the global email transporter
async function updateEmailTransporter(organizationId) {
  try {
    const newTransporter = await createTransporterFromSettings(organizationId);
    if (newTransporter) {
      // Replace the global transporter with the new one
      emailTransporter = newTransporter;
      console.log('✅ Email transporter updated with new settings');

      // Verify the new connection
      emailTransporter.verify((error, success) => {
        if (error) {
          console.log('⚠️  Email transporter verification failed after update:', error.message);
        } else {
          console.log('✅ Email transporter verified successfully');
        }
      });
    }
  } catch (error) {
    console.error('Error updating email transporter:', error);
  }
}

// CSRF error handler
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    console.warn('⚠️  CSRF token validation failed');
    if (req.accepts('json')) {
      return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    return res.status(403).send('Invalid CSRF token');
  }
  next(err);
});

// Start the server
const server = app.listen(PORT, () => {
  console.log(`🚀 Server is running http://localhost:${PORT}`);
  console.log(`🗄️  Database: SQLite (data/data.db)`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    db.closeDatabase();
    process.exit(0);
  });
}); 