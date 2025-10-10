require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const app = express();
const PORT = process.env.PORT || 3000;
const db = require('./database');
const quickbooks = require('./quickbooks');
const ReceiptGenerator = require('./receipt-generator');
const TemplateManager = require('./template-manager');
const multer = require('multer');

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

// Set EJS as template engine
app.set('view engine', 'ejs');
app.set('views', './views');

// Middleware to parse JSON bodies with increased limit for logo uploads
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Serve static files from public directory
app.use(express.static('public'));

// Template manager page
app.get('/template', (req, res) => {
  res.render('template-manager');
});

// Basic route for Hello World
app.get('/', async (req, res) => {
  try {
    let transactions;
    
    // Get organization ID from realmId cookie if available
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
      // No active QuickBooks connection - check for last organization ID
      if (req.cookies && req.cookies.lastOrganizationId) {
        const lastOrganizationId = parseInt(req.cookies.lastOrganizationId);
        console.log('🔍 No active QuickBooks connection, using last organization ID:', lastOrganizationId);
        
        try {
          const lastOrganization = await db.getOrganizationById(lastOrganizationId);
          if (lastOrganization) {
            console.log('✅ Found last organization:', lastOrganization.name, '(ID:', lastOrganizationId + ')');
            transactions = await db.getTransactionsByOrganizationId(lastOrganizationId);
          } else {
            console.log('⚠️ Last organization not found, fetching all transactions');
            transactions = await db.getAllTransactions();
          }
        } catch (orgError) {
          console.error('❌ Error getting last organization:', orgError.message);
          console.log('⚠️ Falling back to all transactions');
          transactions = await db.getAllTransactions();
        }
      } else {
        console.log('⚠️ No realmId or lastOrganizationId cookie found, fetching all transactions');
        transactions = await db.getAllTransactions();
      }
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
    
    res.render('table', { 
      data,
      quickbooksConnected: quickbooksConnected,
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
    let transactions;
    
    // Get organization ID from realmId cookie if available
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
      // No active QuickBooks connection - check for last organization ID
      if (req.cookies && req.cookies.lastOrganizationId) {
        const lastOrganizationId = parseInt(req.cookies.lastOrganizationId);
        console.log('🔍 API: No active QuickBooks connection, using last organization ID:', lastOrganizationId);
        
        try {
          const lastOrganization = await db.getOrganizationById(lastOrganizationId);
          if (lastOrganization) {
            console.log('✅ API: Found last organization:', lastOrganization.name, '(ID:', lastOrganizationId + ')');
            transactions = await db.getTransactionsByOrganizationId(lastOrganizationId);
          } else {
            console.log('⚠️ API: Last organization not found, fetching all transactions');
            transactions = await db.getAllTransactions();
          }
        } catch (orgError) {
          console.error('❌ API: Error getting last organization:', orgError.message);
          console.log('⚠️ API: Falling back to all transactions');
          transactions = await db.getAllTransactions();
        }
      } else {
        console.log('⚠️ API: No realmId or lastOrganizationId cookie found, fetching all transactions');
        transactions = await db.getAllTransactions();
      }
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
    const donor = await db.getDonorByQbCustomerId(qbCustomerId);
    
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
    
    console.log(`🔄 Syncing donor from transaction ${transactionId} with QB customer ID: ${qbCustomerId}`);
    console.log(`📋 Transaction details: name="${transaction.name}", extracted customer name="${customerName}", customer ID="${qbCustomerId}"`);
    
    // Check if donor already exists
    const existingDonor = await db.getDonorByQbCustomerId(qbCustomerId);
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
    const syncResult = await db.syncDonorFromQuickbooks(qbCustomer);
    
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
    
    // Get all transactions
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
        let qbCustomerId = null;
        let customerName = null;
        
        try {
          const nameData = JSON.parse(transaction.name);
          qbCustomerId = nameData.id;
          customerName = nameData.Value;
        } catch (error) {
          console.log(`⚠️  Transaction ${transaction.id} name field is not valid JSON, skipping`);
          console.log(`   Transaction details: name="${transaction.name}"`);
          results.skipped++;
          continue;
        }
        
        if (!qbCustomerId) {
          console.log(`⚠️  Transaction ${transaction.id} has no QB customer ID in name JSON, skipping`);
          console.log(`   Transaction details: name="${transaction.name}", extracted customer name="${customerName}"`);
          results.skipped++;
          continue;
        }
        
        // Check if donor already exists
        const existingDonor = await db.getDonorByQbCustomerId(qbCustomerId);
        if (existingDonor) {
          console.log(`⏭️  Donor already exists for QB customer ID: ${qbCustomerId} (${customerName})`);
          results.skipped++;
          continue;
        }
        
        // Get customer data from Quickbooks using the customer ID
        console.log(`🔍 Fetching customer data from Quickbooks for ID: ${qbCustomerId} (${customerName})`);
        const qbCustomer = await quickbooks.getCustomerById(qbCustomerId);
        
        // Sync donor from Quickbooks customer data
        const syncResult = await db.syncDonorFromQuickbooks(qbCustomer);
        
        if (syncResult.action === 'created') {
          results.created++;
        } else {
          results.skipped++;
        }
        
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
      message: 'Donor sync completed',
      results: results
    });
    
  } catch (error) {
    console.error('Error syncing all donors from transactions:', error);
    res.status(500).json({ error: 'Failed to sync donors: ' + error.message });
  }
});

// Quickbooks authentication routes
app.get('/auth/quickbooks', (req, res) => {
  try {
    const authData = quickbooks.generateAuthURL();
    // Store state in session or database for security
    res.redirect(authData.url);
  } catch (error) {
    console.error('Error generating auth URL:', error);
    res.status(500).json({ error: 'Failed to generate authentication URL' });
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
    
    // Store realmId as a cookie (expires in 30 days)
    res.cookie('quickbooks_realmId', realmId, {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production'
    });
    
    // Clear the lastOrganizationId cookie since we have a new active connection
    res.clearCookie('lastOrganizationId');
    
    // Log cookie storage success
    console.log('🍪 Cookie stored successfully!');
    console.log(`   Realm ID stored in cookie: ${realmId}`);
    console.log(`   Cookie expires in 30 days`);
    
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
            body {
              font-family: Arial, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
    res.clearCookie('quickbooks_realmId');
    
    // Store the last organization ID in a cookie (expires in 30 days)
    if (lastOrganizationId) {
      res.cookie('lastOrganizationId', lastOrganizationId.toString(), {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        httpOnly: true,
        secure: false // Set to true in production with HTTPS
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

    

    // Get query parameters from request with defaults
    const queryParams = {
      start_date: req.query.start_date || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 7 days ago
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
        console.log(`🔄 Processing donor creation for ${dbResults.savedTransactions.length} saved transactions`);
        const donorProcessingResults = {
          created: 0,
          skipped: 0,
          errors: []
        };
        
        for (const transaction of dbResults.savedTransactions) {
          try {
            if (transaction.name_id) {
              const donorResult = await db.processDonorFromTransaction(transaction, quickbooks);
              if (donorResult.action === 'created') {
                // Link the newly created donor to the transaction
                console.log(`🔗 Linking newly created donor ${donorResult.id} to transaction ${transaction.id}`);
                await db.updateTransactionDonorId(transaction.id, donorResult.id);
                donorProcessingResults.created++;
              } else if (donorResult.action === 'skipped' && donorResult.donor && donorResult.donor.id) {
                // If donor already exists, link the transaction to it
                console.log(`🔗 Linking existing donor ${donorResult.donor.id} to transaction ${transaction.id}`);
                await db.updateTransactionDonorId(transaction.id, donorResult.donor.id);
                donorProcessingResults.skipped++;
              } else {
                donorProcessingResults.skipped++;
              }
            } else {
              donorProcessingResults.skipped++;
            }
          } catch (error) {
            console.error(`❌ Error processing donor for transaction:`, error);
            donorProcessingResults.errors.push({
              transaction: transaction,
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
    const organization = await db.getOrganizationByQbId(req.cookies.quickbooks_realmId) || 
                        (await db.getAllOrganizations())[0];
    
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    
    // Create email content
    const emailContent = {
      to: email,
      subject: subject || 'Your Donation Receipt',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Thank you for your donation!</h2>
          <p>Dear ${donor.name},</p>
          <p>Thank you for your generous donation to ${organization.name}.</p>
          ${message ? `<p>${message.replace(/\n/g, '<br>')}</p>` : ''}
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
    
    // Send actual email using Nodemailer
    const nodemailer = require('nodemailer');
    
    // Create transporter
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: process.env.EMAIL_PORT || 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
    
    // Send email
    const mailOptions = {
      from: process.env.EMAIL_USER,
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

// Start the server
const server = app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`🗄️  Database: SQLite (data.db)`);
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