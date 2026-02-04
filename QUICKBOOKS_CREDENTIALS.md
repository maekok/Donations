# QuickBooks Credentials Configuration

## Overview

QuickBooks client ID and client secret are now stored in the database options table instead of hardcoded in the source code. This provides better security and allows separate credentials for sandbox and production environments.

## Database Storage

Credentials are stored as global options (organizationId = null) with the following keys:

### Sandbox Environment
- `QUICKBOOKS_CLIENT_ID_SANDBOX` - Sandbox client ID
- `QUICKBOOKS_CLIENT_SECRET_SANDBOX` - Sandbox client secret

### Production Environment
- `QUICKBOOKS_CLIENT_ID_PRODUCTION` - Production client ID
- `QUICKBOOKS_CLIENT_SECRET_PRODUCTION` - Production client secret

## Environment Detection

The application determines which credentials to use based on the `QUICKBOOKS_ENVIRONMENT` environment variable:
- `sandbox` (default) → Uses `*_SANDBOX` credentials
- `production` → Uses `*_PRODUCTION` credentials

## Priority Order

Credentials are loaded in the following priority order:

1. **Environment Variables (First Priority)**
   - `QUICKBOOKS_CLIENT_ID_SANDBOX` or `QUICKBOOKS_CLIENT_ID_PRODUCTION` (environment-specific)
   - `QUICKBOOKS_CLIENT_SECRET_SANDBOX` or `QUICKBOOKS_CLIENT_SECRET_PRODUCTION` (environment-specific)
   - `QUICKBOOKS_CLIENT_ID` (generic, works for both environments)
   - `QUICKBOOKS_CLIENT_SECRET` (generic, works for both environments)

2. **Database Options (Fallback)**
   - `QUICKBOOKS_CLIENT_ID_SANDBOX` or `QUICKBOOKS_CLIENT_ID_PRODUCTION`
   - `QUICKBOOKS_CLIENT_SECRET_SANDBOX` or `QUICKBOOKS_CLIENT_SECRET_PRODUCTION`

If neither environment variables nor database options are set, the application will throw an error.

## Setting Up Credentials

### Option 1: Using SQL (Direct Database Access)

```sql
-- Sandbox credentials
INSERT INTO options (organizationId, key, value) 
VALUES (NULL, 'QUICKBOOKS_CLIENT_ID_SANDBOX', 'your-sandbox-client-id');

INSERT INTO options (organizationId, key, value) 
VALUES (NULL, 'QUICKBOOKS_CLIENT_SECRET_SANDBOX', 'your-sandbox-client-secret');

-- Production credentials
INSERT INTO options (organizationId, key, value) 
VALUES (NULL, 'QUICKBOOKS_CLIENT_ID_PRODUCTION', 'your-production-client-id');

INSERT INTO options (organizationId, key, value) 
VALUES (NULL, 'QUICKBOOKS_CLIENT_SECRET_PRODUCTION', 'your-production-client-secret');
```

### Option 2: Using the GoBlue Admin Page

1. Navigate to the GoBlue admin page
2. Go to the "Options" section (if available)
3. Add the credential options manually

### Option 3: Using Environment Variables (Recommended)

Environment variables are checked first and are the recommended approach for production deployments:

```bash
# Environment-specific (recommended)
export QUICKBOOKS_CLIENT_ID_SANDBOX="your-sandbox-client-id"
export QUICKBOOKS_CLIENT_SECRET_SANDBOX="your-sandbox-client-secret"

export QUICKBOOKS_CLIENT_ID_PRODUCTION="your-production-client-id"
export QUICKBOOKS_CLIENT_SECRET_PRODUCTION="your-production-client-secret"

# Or generic (works for both environments)
export QUICKBOOKS_CLIENT_ID="your-client-id"
export QUICKBOOKS_CLIENT_SECRET="your-client-secret"
export QUICKBOOKS_ENVIRONMENT="sandbox"  # or "production"
```

**Note**: Environment variables take priority over database values. This is useful for:
- Production deployments (secrets management)
- Docker/Kubernetes environments
- CI/CD pipelines
- Local development overrides

## Implementation Details

### Lazy Loading

Credentials are loaded on-demand (lazy loading) when first needed:
- First API call triggers credential loading
- Credentials are cached after first load
- No credentials are loaded at application startup

### Thread Safety

The implementation includes basic thread safety:
- Prevents multiple simultaneous credential loads
- Uses a loading flag to coordinate concurrent requests

### Error Handling

If credentials cannot be loaded:
- Clear error message indicating which keys are missing
- Application will fail fast rather than using invalid credentials
- Error logged to console for debugging

## Code Changes

### quickbooks.js

1. **Constructor**: Removed hardcoded credentials
2. **New Methods**:
   - `loadCredentials()` - Loads credentials from database
   - `ensureCredentials()` - Ensures credentials are loaded before use
3. **Updated Methods** (now async):
   - `generateAuthURL()` - Now async, loads credentials first
   - `exchangeCodeForToken()` - Ensures credentials before use
   - `refreshAccessToken()` - Ensures credentials before use
   - `revokeToken()` - Ensures credentials before use

### server.js

1. **Route Handler**: Updated `/auth/quickbooks` to be async and await `generateAuthURL()`

## Security Benefits

1. **No Hardcoded Secrets**: Credentials removed from source code
2. **Environment Separation**: Different credentials for sandbox vs production
3. **Environment Variable Priority**: Production deployments can use secrets management systems
4. **Database Fallback**: Credentials can be stored in database for convenience
5. **Flexible Configuration**: Supports both environment variables and database storage

## Migration Notes

### Existing Deployments

If you have existing deployments with hardcoded credentials:

1. **Before deploying this change**: Add credentials to the options table
2. **After deploying**: The application will automatically use database credentials
3. **Remove old code**: The hardcoded fallback values have been removed

### Testing

To test the new credential loading:

1. Set up credentials in the database
2. Restart the application
3. Attempt to connect to QuickBooks
4. Verify credentials are loaded from database (check console logs)

## Troubleshooting

### Error: "QuickBooks credentials not found"

**Solution**: 
1. First, try setting environment variables (recommended for production)
2. If environment variables aren't available, add credentials to the options table
3. Ensure the correct environment suffix is used (`_SANDBOX` or `_PRODUCTION`)

### Error: "Failed to load credentials"

**Possible Causes**:
- Database connection issue
- Options table doesn't exist
- Invalid option keys

**Solution**: Check database connection and verify options table structure.

### Credentials Not Updating

**Solution**: Restart the application after updating credentials in the database. The credentials are cached after first load.

