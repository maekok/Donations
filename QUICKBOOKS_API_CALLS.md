# QuickBooks API Calls Summary

This document lists all QuickBooks API calls made by the application.

## OAuth/Authentication Endpoints

### 1. **Generate Authorization URL**
- **Method**: `quickbooks.generateAuthURL()`
- **QuickBooks Endpoint**: `https://appcenter.intuit.com/connect/oauth2`
- **Purpose**: Generate OAuth authorization URL for user to connect their QuickBooks account
- **Used in**: `/auth/quickbooks` route
- **Returns**: Authorization URL and state token

### 2. **Exchange Authorization Code for Token**
- **Method**: `quickbooks.exchangeCodeForToken(code, realmId)`
- **QuickBooks Endpoint**: `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`
- **Purpose**: Exchange OAuth authorization code for access and refresh tokens
- **Used in**: `/auth/quickbooks/callback` route
- **Returns**: Access token, refresh token, realmId, expiration time

### 3. **Refresh Access Token**
- **Method**: `quickbooks.refreshAccessToken()` (called automatically via `ensureValidToken()`)
- **QuickBooks Endpoint**: `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`
- **Purpose**: Refresh expired access token using refresh token
- **Used in**: Automatic token management (before each API call)
- **Returns**: New access token and refresh token

### 4. **Revoke Token**
- **Method**: `quickbooks.revokeToken()` (called via `fullDisconnect()`)
- **QuickBooks Endpoint**: `https://developer.api.intuit.com/v2/oauth2/tokens/revoke`
- **Purpose**: Revoke access token when disconnecting from QuickBooks
- **Used in**: `/api/quickbooks/disconnect` route
- **Returns**: Success/failure status

---

## Data Retrieval API Calls

### 5. **Get Company Info**
- **Method**: `quickbooks.getCompanyInfo()`
- **QuickBooks API Endpoint**: `GET /v3/company/{realmId}/companyinfo/1`
- **Purpose**: Retrieve company/organization information
- **Used in**:
  - `/auth/quickbooks/callback` - Auto-sync organization on first connect
  - `/api/quickbooks/sync-organization` - Manual organization sync
  - `/api/quickbooks/force-sync-organization` - Force re-sync organization
- **Returns**: Company name, address, EIN, contact info, etc.

### 6. **Get Customers**
- **Method**: `quickbooks.getCustomers()`
- **QuickBooks API Endpoint**: `GET /v3/company/{realmId}/query?query=SELECT * FROM Customer MAXRESULTS 1000`
- **Purpose**: Retrieve all customers from QuickBooks
- **Used in**: `/api/quickbooks/customers` route
- **Returns**: Array of Customer objects

### 7. **Get Customer by ID**
- **Method**: `quickbooks.getCustomerById(customerId)`
- **QuickBooks API Endpoint**: `GET /v3/company/{realmId}/customer/{customerId}`
- **Purpose**: Retrieve specific customer details by QuickBooks customer ID
- **Used in**: `/api/transactions/:id/sync-donor` route
- **Returns**: Single Customer object with full details

### 8. **Get Transaction Report**
- **Method**: `quickbooks.getTransactionReport(queryParams)`
- **QuickBooks API Endpoint**: `GET /v3/company/{realmId}/reports/TransactionList`
- **Purpose**: Retrieve transaction list report with filtering options
- **Query Parameters**:
  - `start_date`: Start date for report (default: 365 days ago)
  - `end_date`: End date for report (default: today)
  - `report_type`: Always 'TransactionList'
  - `transaction_type`: Type of transactions (default: 'SalesReceipt')
  - `columns`: Columns to include in report
  - `sort_by`: Sort field (default: 'tx_date')
  - `sort_order`: Sort direction (default: 'desc')
  - `max_results`: Maximum results (default: 100)
- **Used in**: `/api/quickbooks/transactions` route
- **Returns**: Transaction report data with rows and columns

### 9. **Get Sales Receipt by ID**
- **Method**: `quickbooks.getSalesReceiptById(salesReceiptId)`
- **QuickBooks API Endpoint**: `GET /v3/company/{realmId}/salesreceipt/{salesReceiptId}`
- **Purpose**: Retrieve detailed SalesReceipt information including line items
- **Used in**: `/api/quickbooks/transactions` route (for each transaction with a sales receipt ID)
- **Returns**: Complete SalesReceipt object with line items, customer info, amounts, etc.

### 10. **Get Invoices** (Available but not currently used)
- **Method**: `quickbooks.getInvoices()`
- **QuickBooks API Endpoint**: `GET /v3/company/{realmId}/query?query=SELECT * FROM Invoice MAXRESULTS 1000`
- **Purpose**: Retrieve all invoices
- **Status**: Method exists but not called in server.js
- **Returns**: Array of Invoice objects

### 11. **Get Payments** (Available but not currently used)
- **Method**: `quickbooks.getPayments()`
- **QuickBooks API Endpoint**: `GET /v3/company/{realmId}/query?query=SELECT * FROM Payment MAXRESULTS 1000`
- **Purpose**: Retrieve all payments
- **Status**: Method exists but not called in server.js
- **Returns**: Array of Payment objects

---

## Data Creation API Calls

### 12. **Create Customer**
- **Method**: `quickbooks.createCustomer(customerData)`
- **QuickBooks API Endpoint**: `POST /v3/company/{realmId}/customer`
- **Purpose**: Create a new customer in QuickBooks
- **Used in**: `quickbooks.syncToQuickbooks()` method (which is called from `/api/quickbooks/sync`)
- **Status**: Method exists but sync endpoint may not be actively used
- **Request Body**: Customer name, email, address, city, state, zip, country
- **Returns**: Created Customer object with QuickBooks ID

### 13. **Create Invoice**
- **Method**: `quickbooks.createInvoice(invoiceData)`
- **QuickBooks API Endpoint**: `POST /v3/company/{realmId}/invoice`
- **Purpose**: Create a new invoice in QuickBooks
- **Used in**: `quickbooks.syncToQuickbooks()` method (which is called from `/api/quickbooks/sync`)
- **Status**: Method exists but sync endpoint may not be actively used
- **Request Body**: Customer reference, line items with amounts and quantities
- **Returns**: Created Invoice object with QuickBooks ID

---

## Status/Utility Methods

### 14. **Get Sync Status**
- **Method**: `quickbooks.getSyncStatus()`
- **Purpose**: Check authentication status and token information
- **Used in**:
  - `/api/quickbooks/status` - Check connection status
  - `/api/quickbooks/sync-donor` - Verify authentication before syncing
  - `/api/quickbooks/sync` - Verify authentication before syncing
  - `/api/quickbooks/sync-organization` - Verify authentication before syncing
  - `/api/quickbooks/customers` - Verify authentication before fetching
  - `/api/quickbooks/transactions` - Verify authentication before fetching
- **Returns**: Object with `isAuthenticated`, `tokenExpiry`, `realmId`, `environment`

### 15. **Sync to QuickBooks** (Bulk Operation)
- **Method**: `quickbooks.syncToQuickbooks(localData)`
- **Purpose**: Bulk sync local data to QuickBooks (creates customers and invoices)
- **Used in**: `/api/quickbooks/sync` route
- **Status**: Method exists but may not be actively used
- **Operations**: 
  - Checks if customers exist, creates if not
  - Creates invoices for each record
- **Returns**: Results object with counts of created/updated items and errors

---

## API Call Summary by Route

### Authentication Routes
- `/auth/quickbooks` → `generateAuthURL()`
- `/auth/quickbooks/callback` → `exchangeCodeForToken()`, `getCompanyInfo()`
- `/api/quickbooks/disconnect` → `fullDisconnect()` → `revokeToken()`

### Data Retrieval Routes
- `/api/quickbooks/status` → `getSyncStatus()`
- `/api/quickbooks/customers` → `getSyncStatus()`, `getCustomers()`
- `/api/quickbooks/transactions` → `getSyncStatus()`, `getTransactionReport()`, `getSalesReceiptById()` (for each transaction)
- `/api/quickbooks/sync-organization` → `getSyncStatus()`, `getCompanyInfo()`
- `/api/quickbooks/force-sync-organization` → `getSyncStatus()`, `getCompanyInfo()`

### Data Sync Routes
- `/api/transactions/:id/sync-donor` → `getSyncStatus()`, `getCustomerById()`
- `/api/quickbooks/sync-donor` → `getSyncStatus()`
- `/api/quickbooks/sync` → `getSyncStatus()`, `syncToQuickbooks()` → `getCustomers()`, `createCustomer()`, `createInvoice()`

---

## Base URLs

### Sandbox Environment
- **API Base**: `https://sandbox-quickbooks.api.intuit.com/v3/company`
- **OAuth**: `https://appcenter.intuit.com/connect/oauth2`
- **Token**: `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`

### Production Environment
- **API Base**: `https://quickbooks.api.intuit.com/v3/company`
- **OAuth**: `https://appcenter.intuit.com/connect/oauth2`
- **Token**: `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`

---

## Notes

1. **Token Management**: All API calls automatically refresh tokens if they're expiring soon (within 5 minutes) via `ensureValidToken()`.

2. **Error Handling**: All API calls include comprehensive error logging and throw descriptive errors.

3. **Rate Limiting**: QuickBooks API has rate limits. The application doesn't implement rate limiting, so be aware of QuickBooks' limits:
   - 500 requests per minute per company
   - 1000 requests per day per company

4. **Unused Methods**: Some methods exist in `quickbooks.js` but aren't called in `server.js`:
   - `getInvoices()` - Available but not used
   - `getPayments()` - Available but not used
   - `syncToQuickbooks()` - Exists but the sync endpoint may not be actively used

5. **Primary Use Cases**:
   - **Organization Sync**: Fetching company info to sync organization data
   - **Transaction Sync**: Fetching transaction reports and sales receipt details
   - **Donor Sync**: Fetching customer data to create/update donor records
   - **Status Checks**: Verifying authentication status

