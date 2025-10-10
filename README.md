# Express.js Data Table with SQLite

A simple Express.js application that displays a data table with PDF action buttons using EJS templating and SQLite database.

## Features

- 🎨 Clean, modern table design with hover effects
- 📱 Responsive layout that works on all devices
- 🔌 RESTful API endpoints for CRUD operations
- 📄 PDF action buttons for each row
- 🎯 EJS templating for clean code separation
- 🗄️ SQLite database for data persistence
- 🧾 Automatic receipt generation for donations
- 🔗 Quickbooks integration for transaction sync
- 🚀 Easy to run and deploy

## Installation

1. Install dependencies:
```bash
npm install
```

2. The application uses EJS templating engine and serves static files from the `public` directory.

## Running the Application

### Development Mode (with auto-reload)
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

## Usage

Once the server is running, you can access:

- **Main Page**: http://localhost:3000
- **API Endpoints**:
  - `GET /api/hello` - Hello world endpoint
  
  **Transactions:**
  - `GET /api/transactions` - Get all transactions
  - `POST /api/transactions` - Add new transaction
  - `PUT /api/transactions/:id` - Update transaction
  - `DELETE /api/transactions/:id` - Delete transaction
  
  **Users:**
  - `GET /api/users` - Get all users
  - `POST /api/users` - Add new user
  - `PUT /api/users/:id` - Update user
  - `DELETE /api/users/:id` - Delete user
  - `GET /api/users/:id` - Get user by ID
  - `GET /api/users/company/:companyId` - Get users by company ID
  - `GET /api/users/player/:playerId` - Get user by player ID
  
  **Donors:**
  - `GET /api/donors` - Get all donors
  - `POST /api/donors` - Add new donor
  - `PUT /api/donors/:id` - Update donor
  - `DELETE /api/donors/:id` - Delete donor
  - `GET /api/donors/:id` - Get donor by ID
  - `GET /api/donors/qb/:qbCustomerId` - Get donor by Quickbooks customer ID
  - `POST /api/donors/sync-from-transaction/:transactionId` - Sync donor from transaction
  - `POST /api/donors/sync-all-from-transactions` - Sync all donors from transactions

  **Organizations:**
  - `GET /api/organizations` - Get all organizations
  - `POST /api/organizations` - Add new organization
  - `PUT /api/organizations/:id` - Update organization
  - `DELETE /api/organizations/:id` - Delete organization
  - `GET /api/organizations/:id` - Get organization by ID
  - `GET /api/organizations/ein/:ein` - Get organization by EIN

  **Receipt Generation:**
  - `POST /api/receipts/generate/:transactionId` - Generate receipt for specific transaction
  - `POST /api/receipts/generate-all` - Generate receipts for all transactions without receipts
  - `GET /receipts/:receiptNumber` - Download receipt PDF file from database

  **Receipt Management:**
  - `GET /api/receipts` - Get all receipts with donor and transaction info
  - `GET /api/receipts/:id` - Get receipt by ID
  - `GET /api/receipts/donor/:donorId` - Get all receipts for a specific donor
  - `PUT /api/receipts/:id/sent` - Update receipt sent date
  - `DELETE /api/receipts/:id` - Delete receipt

  **Template Management:**
  - `GET /api/template` - Get current template configuration
  - `PUT /api/template/organization` - Update organization information
  - `PUT /api/template/receipt` - Update receipt settings
  - `PUT /api/template/branding` - Update branding options
  - `POST /api/template/logo` - Upload organization logo
  - `DELETE /api/template/logo` - Delete organization logo
  - `GET /api/template/logo` - Get logo file

The main page displays a data table with transaction information from the SQLite database and PDF action buttons for each row. The page includes a hamburger menu (triple horizontal lines) that provides access to:

- **Organization Settings**: Popup dialog for managing organization information
- **Template Settings**: Link to receipt template management
- **Generate All Receipts**: Bulk receipt generation
- **Sync with Quickbooks**: Quickbooks integration

## API Endpoints

### GET /
Returns a beautiful HTML page with "Hello World" message.

### GET /api/hello
Returns JSON response:
```json
{
  "message": "Hello World!",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "server": "Express.js"
}
```

## Database Schema

### Transactions Table
- `id` (INTEGER PRIMARY KEY) - Unique identifier
- `date` (TEXT) - Transaction date
- `amount` (TEXT) - Transaction amount
- `qb_docnum` (TEXT) - Quickbooks document number
- `created_at` (DATETIME) - Record creation timestamp
- `donor_id` (INTEGER) - Reference to donors table

### Users Table
- `id` (INTEGER PRIMARY KEY) - Unique identifier
- `name` (TEXT) - User's full name
- `email` (TEXT) - User's email address
- `address` (TEXT) - User's address
- `companyid` (INTEGER) - Associated company ID
- `playerId` (TEXT) - Player identifier
- `created_at` (DATETIME) - Record creation timestamp

### Donors Table
- `id` (INTEGER PRIMARY KEY) - Unique identifier
- `qb_customer_id` (TEXT UNIQUE) - Quickbooks customer ID
- `name` (TEXT) - Donor's full name
- `email` (TEXT) - Donor's email address
- `phone` (TEXT) - Donor's phone number
- `address` (TEXT) - Donor's address
- `city` (TEXT) - Donor's city
- `state` (TEXT) - Donor's state/province
- `zip` (TEXT) - Donor's postal code
- `country` (TEXT) - Donor's country
- `company` (TEXT) - Donor's company name
- `notes` (TEXT) - Additional notes
- `created_at` (DATETIME) - Record creation timestamp
- `updated_at` (DATETIME) - Record last update timestamp

### Organizations Table
- `id` (INTEGER PRIMARY KEY) - Unique identifier
- `name` (TEXT NOT NULL) - Organization name
- `ein` (TEXT UNIQUE) - Employer Identification Number (encrypted)
- `address` (TEXT) - Organization address
- `city` (TEXT) - Organization city
- `state` (TEXT) - Organization state
- `zip` (TEXT) - Organization zip code
- `email` (TEXT) - Organization email
- `phone` (TEXT) - Organization phone number
- `contact` (TEXT) - Primary contact person
- `type` (TEXT) - Organization type (e.g., Non-Profit, For-Profit)
- `url` (TEXT) - Organization website URL
- `created_at` (DATETIME) - Record creation timestamp
- `updated_at` (DATETIME) - Record last update timestamp

### Receipts Table
- `id` (INTEGER PRIMARY KEY) - Unique identifier
- `companyid` (INTEGER) - Company/organization ID
- `donorid` (INTEGER) - Reference to donors table
- `dategenerated` (DATETIME) - Date when receipt was generated
- `datesent` (DATETIME) - Date when receipt was sent to donor
- `receipt_blob` (BLOB) - PDF receipt data stored as binary
- `receipt_filename` (TEXT) - Original filename of the receipt
- `transaction_id` (INTEGER) - Reference to transactions table

## Project Structure

```
express-data-table/
├── package.json          # Project dependencies and scripts
├── server.js             # Main Express.js server file
├── database.js           # SQLite database operations
├── receipt-generator.js  # PDF receipt generation module
├── quickbooks.js         # Quickbooks API integration
├── template-manager.js   # Template management system
├── encryption.js         # EIN encryption utilities
├── data.db               # SQLite database file (created automatically)
├── migrate.js            # Database migration script
├── config/
│   └── receipt-template.json  # Template configuration (auto-created)
├── views/
│   ├── table.ejs         # EJS template for the data table
│   └── template-manager.ejs  # Template management interface
├── public/
│   ├── css/
│   │   ├── style.css     # Styles for the table and layout
│   │   └── template-manager.css  # Template manager styles
│   ├── js/
│   │   ├── script.js     # JavaScript functionality
│   │   └── template-manager.js  # Template manager functionality
│   └── assets/           # Uploaded logos and assets
└── README.md             # This file
```

## EIN Encryption System

The application includes a robust encryption system for protecting sensitive EIN (Employer Identification Number) data:

### Security Features
- **AES Encryption**: EINs are encrypted using AES-256 encryption before storage
- **Automatic Encryption**: All EIN data is automatically encrypted when stored and decrypted when retrieved
- **Migration Support**: Existing EIN data can be encrypted using migration scripts
- **Error Handling**: Graceful handling of encryption/decryption errors with fallback to null values

### Implementation Details
- **Encryption Key**: Uses environment variable `ENCRYPTION_KEY` or default key (change in production)
- **Database Storage**: EINs are stored as encrypted strings in the database
- **API Transparency**: Encryption/decryption is transparent to API consumers
- **Lookup Support**: EIN-based lookups work correctly with encrypted data

### Security Best Practices
- **Environment Variables**: Store encryption keys in environment variables, not in code
- **Key Rotation**: Regularly rotate encryption keys in production environments
- **Access Control**: Implement proper access controls for EIN data
- **Audit Logging**: Log access to sensitive EIN data

## Organization Management Dialog

The application includes a popup dialog for managing organization information, accessible via the hamburger menu:

### Features
- **Popup Dialog**: Modal window that appears over the main interface
- **Form Validation**: Required field validation and input formatting
- **Auto-Load**: Automatically loads existing organization data
- **Save/Cancel**: Save changes or cancel without saving
- **Input Formatting**: Automatic formatting for EIN, phone, ZIP, and state fields

### Form Fields
- **Organization Name** (required)
- **EIN** (formatted as XX-XXXXXXX)
- **Address** (street address)
- **City, State, ZIP** (formatted appropriately)
- **Email** (email validation)
- **Phone** (formatted as XXX-XXX-XXXX)
- **Primary Contact** (contact person name)
- **Organization Type** (dropdown selection)
- **Website URL** (URL validation)

### User Experience
- **Responsive Design**: Works on desktop and mobile devices
- **Keyboard Navigation**: Escape key closes dialog
- **Click Outside**: Click outside dialog to close
- **Visual Feedback**: Success/error notifications
- **Data Persistence**: Saves to organizations table with encryption

## Template-Based Receipt System

The application includes a comprehensive template management system that allows users to customize their receipt appearance:

### Template Features
- **Organization Information**: Set organization name, EIN, address, contact details
- **Logo Management**: Upload, position, and size organization logo
- **Receipt Customization**: Customize title, subtitle, and footer text
- **Branding Options**: Control which elements appear on receipts (logo, EIN, address, contact)
- **Live Preview**: Generate preview receipts to see changes immediately

### Template Configuration
The template system stores configuration in `config/receipt-template.json` and supports:
- **Organization Details**: Complete organization profile
- **Logo Settings**: Position (top-left, top-center, top-right), dimensions
- **Receipt Text**: Customizable title, subtitle, and footer
- **Branding Controls**: Toggle visibility of various elements

### Template Management Interface
Access the template manager at `/template` to:
- Update organization information and EIN
- Upload and manage organization logo
- Customize receipt appearance and branding
- Generate live previews of receipts

## Donor Sync Workflow

The application includes a sophisticated donor sync system that works with Quickbooks:

### Transaction Format
Transactions should have the `name` field in JSON format:
```json
{
  "Value": "Customer Name",
  "id": "quickbooks_customer_id"
}
```

### Sync Process
1. **Transaction Creation**: When a donor creates a receipt, it's stored as a transaction with the customer name and ID in JSON format
2. **Sync Trigger**: Use the sync endpoints to process transactions:
   - `POST /api/donors/sync-from-transaction/:transactionId` - Sync single transaction
   - `POST /api/donors/sync-all-from-transactions` - Sync all transactions
3. **Data Extraction**: The system extracts the Quickbooks customer ID from the transaction's `name` field
4. **Quickbooks Query**: Uses the customer ID to fetch complete customer data from Quickbooks API
5. **Donor Creation**: Creates a new donor record with the customer information:
   - `qb_customer_id` = Customer ID from transaction
   - `name` = Customer display name from Quickbooks
   - `email` = Primary email from Quickbooks
   - `phone` = Primary phone from Quickbooks
   - `address`, `city`, `state`, `zip`, `country` = Billing address from Quickbooks
   - `company` = Company name from Quickbooks
   - `notes` = Notes from Quickbooks

### Error Handling
- Validates JSON format in transaction name field
- Checks for required customer ID in JSON
- Handles duplicate donors (skips if already exists)
- Provides detailed error messages for troubleshooting

## Customization

You can easily customize the application by:

1. Modifying the data array in `server.js` to change table content
2. Updating the EJS template in `views/table.ejs` for layout changes
3. Styling modifications in `public/css/style.css`
4. Adding new JavaScript functionality in `public/js/script.js`
5. Adding new routes and API endpoints
6. Changing the port number (default: 3000)

## Dependencies

- **express**: Web framework for Node.js
- **ejs**: Template engine for server-side rendering
- **sqlite3**: SQLite database driver
- **pdfkit**: PDF generation library for receipts
- **axios**: HTTP client for Quickbooks API integration
- **nodemon**: Development dependency for auto-reloading (dev mode only) 