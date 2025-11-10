const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const Encryption = require('./encryption');

// Database file path
const dbPath = path.join(__dirname, 'data', 'data.db');

// Create database connection
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('✅ Connected to SQLite database');
    initDatabase();
  }
});

// Initialize database with tables and sample data
function initDatabase() {
  // Create transactions table if it doesn't exist
  const createTransactionsTableSQL = `
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      amount TEXT NOT NULL,
      description TEXT,
      qb_docnum TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      donor_id INTEGER,
      organizationId INTEGER,
      FOREIGN KEY (donor_id) REFERENCES donors (id),
      FOREIGN KEY (organizationId) REFERENCES organizations (id)
    )
  `;

  // Create donors table if it doesn't exist
  const createDonorsTableSQL = `
    CREATE TABLE IF NOT EXISTS donors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      qb_customer_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      country TEXT,
      company TEXT,
      notes TEXT,
      organizationId INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (organizationId) REFERENCES organizations (id),
      UNIQUE(qb_customer_id, organizationId)
    )
  `;

  // Create organization table if it doesn't exist
  const createOrganizationTableSQL = `
    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      ein TEXT UNIQUE,
      address TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      email TEXT,
      phone TEXT,
      contact TEXT,
      type TEXT,
      url TEXT,
      qborganizationid TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;

  // Create receipts table if it doesn't exist
  const createReceiptsTableSQL = `
    CREATE TABLE IF NOT EXISTS receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      companyid INTEGER,
      donorid INTEGER,
      dategenerated DATETIME DEFAULT CURRENT_TIMESTAMP,
      datesent DATETIME,
      receipt_blob BLOB,
      transaction_id INTEGER,
      FOREIGN KEY (donorid) REFERENCES donors (id),
      FOREIGN KEY (transaction_id) REFERENCES transactions (id)
    )
  `;

  // Create logos table if it doesn't exist
  const createLogosTableSQL = `
    CREATE TABLE IF NOT EXISTS logos (
      LogoId INTEGER PRIMARY KEY AUTOINCREMENT,
      Logo BLOB,
      logofilename TEXT,
      logoposition TEXT,
      width INTEGER,
      height INTEGER,
      organizationId INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (organizationId) REFERENCES organizations (id)
    )
  `;

        // Create transaction_items table if it doesn't exist
        const createTransactionItemsTableSQL = `
          CREATE TABLE IF NOT EXISTS transaction_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            description TEXT NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            transactionId INTEGER NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            lineNum INTEGER,
            unitPrice DECIMAL(10,2),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (transactionId) REFERENCES transactions (id) ON DELETE CASCADE
          )
        `;
        
        // Add new columns to existing transaction_items table if they don't exist
        const addLineNumColumnSQL = `ALTER TABLE transaction_items ADD COLUMN lineNum INTEGER`;
        const addUnitPriceColumnSQL = `ALTER TABLE transaction_items ADD COLUMN unitPrice DECIMAL(10,2)`;

  // Create feedback table if it doesn't exist
  const createFeedbackTableSQL = `
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organizationId INTEGER,
      feedback TEXT NOT NULL,
      email TEXT,
      rating INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (organizationId) REFERENCES organizations (id)
    )
  `;

  // Create options table if it doesn't exist
  const createOptionsTableSQL = `
    CREATE TABLE IF NOT EXISTS options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organizationId INTEGER,
      key TEXT NOT NULL,
      value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (organizationId) REFERENCES organizations (id),
      UNIQUE(organizationId, key)
    )
  `;

  // Create transactions table first
  db.run(createTransactionsTableSQL, (err) => {
    if (err) {
      console.error('Error creating transactions table:', err.message);
    } else {
      console.log('✅ Transactions table created or already exists');
      
      // Create donors table
      db.run(createDonorsTableSQL, (err) => {
        if (err) {
          console.error('Error creating donors table:', err.message);
        } else {
          console.log('✅ Donors table created or already exists');
          
          // Create organization table
          db.run(createOrganizationTableSQL, (err) => {
            if (err) {
              console.error('Error creating organization table:', err.message);
            } else {
              console.log('✅ Organization table created or already exists');
              
              // Migration: Add qborganizationid column if it doesn't exist
              db.run('ALTER TABLE organizations ADD COLUMN qborganizationid TEXT', (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                  console.error('Error adding qborganizationid column:', err.message);
                } else if (!err) {
                  console.log('✅ Added qborganizationid column to organizations table');
                }
              });
              
              // Create receipts table
              db.run(createReceiptsTableSQL, (err) => {
                if (err) {
                  console.error('Error creating receipts table:', err.message);
                } else {
                  console.log('✅ Receipts table created or already exists');
                  
                  // Migration: Drop receipt_filename column if it exists
                  db.run('ALTER TABLE receipts DROP COLUMN receipt_filename', (err) => {
                    if (err && !err.message.includes('no such column')) {
                      console.error('Error dropping receipt_filename column:', err.message);
                    } else if (!err) {
                      console.log('✅ Dropped receipt_filename column from receipts table');
                    }
                  });
                  
                  // Create logos table
                  db.run(createLogosTableSQL, (err) => {
                    if (err) {
                      console.error('Error creating logos table:', err.message);
                    } else {
                      console.log('✅ Logos table created or already exists');
                      
                      // Create transaction_items table
                      db.run(createTransactionItemsTableSQL, (err) => {
                        if (err) {
                          console.error('Error creating transaction_items table:', err.message);
                        } else {
                          console.log('✅ Transaction items table created or already exists');
                          
                          // Migration: Add lineNum and unitPrice columns to transaction_items table if they don't exist
                          db.all("PRAGMA table_info(transaction_items)", (err, rows) => {
                            if (err) {
                              console.error('Error checking transaction_items table structure:', err.message);
                            } else {
                              const hasLineNum = rows && rows.some(row => row.name === 'lineNum');
                              const hasUnitPrice = rows && rows.some(row => row.name === 'unitPrice');
                              
                              if (!hasLineNum) {
                                console.log('🔄 Adding lineNum column to transaction_items table...');
                                db.run(addLineNumColumnSQL, (err) => {
                                  if (err) {
                                    console.error('Error adding lineNum column:', err.message);
                                  } else {
                                    console.log('✅ Added lineNum column to transaction_items table');
                                  }
                                });
                              } else {
                                console.log('✅ lineNum column already exists in transaction_items table');
                              }
                              
                              if (!hasUnitPrice) {
                                console.log('🔄 Adding unitPrice column to transaction_items table...');
                                db.run(addUnitPriceColumnSQL, (err) => {
                                  if (err) {
                                    console.error('Error adding unitPrice column:', err.message);
                                  } else {
                                    console.log('✅ Added unitPrice column to transaction_items table');
                                  }
                                });
                              } else {
                                console.log('✅ unitPrice column already exists in transaction_items table');
                              }
                            }
                          });
                          
                          // Migration: Add organizationId column to transactions table if it doesn't exist
                          db.all("PRAGMA table_info(transactions)", (err, rows) => {
                            if (err) {
                              console.error('Error checking transactions table structure:', err.message);
                            } else {
                              const hasOrganizationId = rows && rows.some(row => row.name === 'organizationId');
                              if (!hasOrganizationId) {
                                console.log('🔄 Adding organizationId column to transactions table...');
                                db.run("ALTER TABLE transactions ADD COLUMN organizationId INTEGER", (err) => {
                                  if (err) {
                                    console.error('Error adding organizationId column:', err.message);
                                  } else {
                                    console.log('✅ Added organizationId column to transactions table');
                                    // Add foreign key constraint
                                    db.run("PRAGMA foreign_keys=ON", (err) => {
                                      if (err) {
                                        console.error('Error enabling foreign keys:', err.message);
                                      } else {
                                        console.log('✅ Foreign key constraints enabled');
                                      }
                                    });
                                  }
                                });
                              } else {
                                console.log('✅ organizationId column already exists in transactions table');
                              }
                              
                              // Migration: Remove description column from transactions table (moved to transaction_items)
                              const hasDescription = rows && rows.some(row => row.name === 'description');
                              if (hasDescription) {
                                console.log('🔄 Removing description column from transactions table (moved to transaction_items)...');
                                // Note: SQLite doesn't support DROP COLUMN directly, so we'll leave it for now
                                // In a production environment, you'd need to recreate the table
                                console.log('⚠️  Description column still exists in transactions table (SQLite limitation)');
                              } else {
                                console.log('✅ description column already removed from transactions table');
                              }
                            }
                          });
                          
                          // Create feedback table
                          db.run(createFeedbackTableSQL, (err) => {
                            if (err) {
                              console.error('Error creating feedback table:', err.message);
                            } else {
                              console.log('✅ Feedback table created or already exists');
                            }
                          });
                          
                          // Create options table
                          db.run(createOptionsTableSQL, (err) => {
                            if (err) {
                              console.error('Error creating options table:', err.message);
                            } else {
                              console.log('✅ Options table created or already exists');
                            }
                          });
                        }
                      });
                    }
                  });
                }
              });
            }
          });
        }
      });
    }
  });
}

// Get all transactions with donor information and item details
function getAllTransactions() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT 
        t.id,
        t.date,
        t.amount as transaction_total,
        t.qb_docnum,
        t.created_at,
        t.organizationId,
        d.name as donor_name,
        d.email as donor_email,
        d.id as donor_id,
        ti.id as item_id,
        ti.description as item_description,
        ti.quantity as item_quantity,
        ti.amount as item_amount,
        ti.created_at as item_created_at
      FROM transactions t
      LEFT JOIN donors d ON t.donor_id = d.id
      LEFT JOIN transaction_items ti ON t.id = ti.transactionId
      ORDER BY t.date DESC, ti.created_at ASC
    `;
    
    db.all(sql, [], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        console.log(`📋 Fetched ${rows.length} transaction rows from database`);
        resolve(rows);
      }
    });
  });
}

// Get transactions by organization ID with item details
function getTransactionsByOrganizationId(organizationId) {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT 
        t.id,
        t.date,
        t.amount as transaction_total,
        t.qb_docnum,
        t.created_at,
        t.organizationId,
        d.name as donor_name,
        d.email as donor_email,
        d.id as donor_id,
        ti.id as item_id,
        ti.description as item_description,
        ti.quantity as item_quantity,
        ti.amount as item_amount,
        ti.created_at as item_created_at
      FROM transactions t
      LEFT JOIN donors d ON t.donor_id = d.id
      LEFT JOIN transaction_items ti ON t.id = ti.transactionId
      WHERE t.organizationId = ?
      ORDER BY t.date DESC, ti.created_at ASC
    `;
    
    db.all(sql, [organizationId], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        console.log(`📋 Fetched ${rows.length} transaction rows for organization ${organizationId}`);
        resolve(rows);
      }
    });
  });
}

// Add new transaction
function addTransaction(transactionData) {
  return new Promise((resolve, reject) => {
    const sql = 'INSERT INTO transactions (date, donor_id, amount, organizationId) VALUES (?, ?, ?, ?)';
    const params = [transactionData.date, transactionData.donor_id, transactionData.amount, transactionData.organizationId || null];
    
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ id: this.lastID, ...transactionData });
      }
    });
  });
}

// Add Quickbooks transaction data
function addQuickbooksTransaction(transactionData) {
  return new Promise((resolve, reject) => {
    // Validate required fields
    if (!transactionData.tx_date) {
      reject(new Error('Missing required field: tx_date'));
      return;
    }
    
    if (!transactionData.name) {
      reject(new Error('Missing required field: name'));
      return;
    }
    
    if (!transactionData.subt_nat_amount) {
      reject(new Error('Missing required field: subt_nat_amount'));
      return;
    }
    
    console.log('💾 Saving transaction to database:', transactionData);
    
    // If we have a name_id, we'll handle donor creation separately
    if (transactionData.name_id) {
      console.log(`📋 Storing customer name: ${transactionData.name} (ID: ${transactionData.name_id})`);
    }
    
    const sql = 'INSERT INTO transactions (date, donor_id, amount, qb_docnum, organizationId) VALUES (?, ?, ?, ?, ?)';
    const params = [
      transactionData.tx_date,
      null, // donor_id will be set after donor creation
      transactionData.subt_nat_amount,
      transactionData.doc_num || null,
      transactionData.organizationId || null
    ];
    
    db.run(sql, params, function(err) {
      if (err) {
        console.error('❌ Database error:', err);
        reject(err);
      } else {
        console.log('✅ Successfully saved transaction with ID:', this.lastID);
        resolve({ id: this.lastID, ...transactionData });
      }
    });
  });
}

// Check if transaction already exists
function checkTransactionExists(qbDocNum) {
  return new Promise((resolve, reject) => {
    if (!qbDocNum) {
      resolve(false); // If no doc_num, we can't check for duplicates
      return;
    }
    
    const sql = 'SELECT COUNT(*) as count FROM transactions WHERE qb_docnum = ?';
    db.get(sql, [qbDocNum], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row.count > 0);
      }
    });
  });
}

// Add multiple Quickbooks transactions (skip duplicates)
function addQuickbooksTransactions(transactions) {
  return new Promise(async (resolve, reject) => {
    const results = {
      added: 0,
      skipped: 0,
      errors: [],
      savedTransactions: [], // Add array to store saved transactions with IDs
      total: transactions.length
    };

    for (let i = 0; i < transactions.length; i++) {
      const transaction = transactions[i];
      
      try {
        // Check if transaction already exists
        const exists = await checkTransactionExists(transaction.doc_num);
        
        if (exists) {
          console.log(`⏭️  Skipping existing transaction: ${transaction.doc_num}`);
          results.skipped++;
          continue;
        }
        
        // Add new transaction and get the saved transaction with ID
        const savedTransaction = await addQuickbooksTransaction(transaction);
        results.added++;
        results.savedTransactions.push({
          ...transaction,
          id: savedTransaction.id, // Include the database ID
          qb_docnum: transaction.doc_num // Ensure qb_docnum field is available for matching
        });
        
      } catch (error) {
        console.error(`❌ Error processing transaction ${i}:`, error);
        results.errors.push({
          index: i,
          transaction: transaction,
          error: error.message
        });
      }
    }

    console.log(`📊 Transaction processing complete: ${results.added} added, ${results.skipped} skipped, ${results.errors.length} errors`);
    resolve(results);
  });
}

// Update transaction
function updateTransaction(id, transactionData) {
  return new Promise((resolve, reject) => {
    const sql = 'UPDATE transactions SET date = ?, donor_id = ?, amount = ?, organizationId = ? WHERE id = ?';
    const params = [transactionData.date, transactionData.donor_id, transactionData.amount, transactionData.organizationId, id];
    
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ id, ...transactionData });
      }
    });
  });
}

// Update transaction donor_id
function updateTransactionDonorId(transactionId, donorId) {
  return new Promise((resolve, reject) => {
    const sql = 'UPDATE transactions SET donor_id = ? WHERE id = ?';
    const params = [donorId, transactionId];
    
    db.run(sql, params, function(err) {
      if (err) {
        console.error('❌ Error updating transaction donor_id:', err);
        reject(err);
      } else {
        console.log(`✅ Updated transaction ${transactionId} with donor_id ${donorId}`);
        resolve({ transactionId, donorId });
      }
    });
  });
}

// Delete transaction
function deleteTransaction(id) {
  return new Promise((resolve, reject) => {
    const sql = 'DELETE FROM transactions WHERE id = ?';
    
    db.run(sql, [id], function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ deleted: this.changes > 0 });
      }
    });
  });
}

// Get transaction by ID
function getTransactionById(id) {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM transactions WHERE id = ?';
    
    db.get(sql, [id], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

// ===== DONOR MANAGEMENT FUNCTIONS =====

// Get all donors
function getAllDonors() {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM donors ORDER BY name ASC';
    
    db.all(sql, [], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// Add new donor
function addDonor(donorData) {
  return new Promise((resolve, reject) => {
    const sql = `INSERT INTO donors (
      qb_customer_id, name, email, phone, address, city, state, zip, country, company, notes, organizationId
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    
    const params = [
      donorData.qb_customer_id,
      donorData.name,
      donorData.email,
      donorData.phone,
      donorData.address,
      donorData.city,
      donorData.state,
      donorData.zip,
      donorData.country,
      donorData.company,
      donorData.notes,
      donorData.organizationId
    ];
    
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ id: this.lastID, ...donorData });
      }
    });
  });
}

// Update donor
function updateDonor(id, donorData) {
  return new Promise((resolve, reject) => {
    const sql = `UPDATE donors SET 
      qb_customer_id = ?, name = ?, email = ?, phone = ?, address = ?, 
      city = ?, state = ?, zip = ?, country = ?, company = ?, notes = ?,
      updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`;
    
    const params = [
      donorData.qb_customer_id,
      donorData.name,
      donorData.email,
      donorData.phone,
      donorData.address,
      donorData.city,
      donorData.state,
      donorData.zip,
      donorData.country,
      donorData.company,
      donorData.notes,
      id
    ];
    
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ id, ...donorData });
      }
    });
  });
}

// Delete donor
function deleteDonor(id) {
  return new Promise((resolve, reject) => {
    const sql = 'DELETE FROM donors WHERE id = ?';
    
    db.run(sql, [id], function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ deleted: this.changes > 0 });
      }
    });
  });
}

// Get donor by ID
function getDonorById(id) {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM donors WHERE id = ?';
    
    db.get(sql, [id], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

// Get donor by Quickbooks customer ID and organization ID
function getDonorByQbCustomerId(qbCustomerId, organizationId) {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM donors WHERE qb_customer_id = ? AND organizationId = ?';
    
    db.get(sql, [qbCustomerId, organizationId], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

// Check if donor exists by Quickbooks customer ID and organization ID
function checkDonorExists(qbCustomerId, organizationId) {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT COUNT(*) as count FROM donors WHERE qb_customer_id = ? AND organizationId = ?';
    
    db.get(sql, [qbCustomerId, organizationId], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row.count > 0);
      }
    });
  });
}

// Sync donor from Quickbooks customer data
function syncDonorFromQuickbooks(qbCustomerData, organizationId) {
  return new Promise(async (resolve, reject) => {
    try {
      // Check if donor already exists
      const exists = await checkDonorExists(qbCustomerData.Id, organizationId);
      
      if (exists) {
        console.log(`⏭️  Donor already exists for QB customer ID: ${qbCustomerData.Id} in organization: ${organizationId}`);
        const existingDonor = await getDonorByQbCustomerId(qbCustomerData.Id, organizationId);
        resolve({ ...existingDonor, action: 'skipped' });
        return;
      }
      
      // Transform Quickbooks customer data to donor format
      const donorData = {
        qb_customer_id: qbCustomerData.Id,
        name: qbCustomerData.DisplayName || qbCustomerData.Name || 'Unknown',
        email: qbCustomerData.PrimaryEmailAddr?.Address || null,
        phone: qbCustomerData.PrimaryPhone?.FreeFormNumber || null,
        address: qbCustomerData.BillAddr?.Line1 || null,
        city: qbCustomerData.BillAddr?.City || null,
        state: qbCustomerData.BillAddr?.CountrySubDivisionCode || null,
        zip: qbCustomerData.BillAddr?.PostalCode || null,
        country: qbCustomerData.BillAddr?.Country || null,
        company: qbCustomerData.CompanyName || null,
        notes: qbCustomerData.Notes || null,
        organizationId: organizationId
      };
      
      console.log(`📋 Mapping QB customer data to donor:`, {
        qb_customer_id: donorData.qb_customer_id,
        name: donorData.name,
        email: donorData.email,
        phone: donorData.phone,
        address: donorData.address,
        city: donorData.city,
        state: donorData.state,
        zip: donorData.zip,
        country: donorData.country,
        company: donorData.company
      });
      
      // Add new donor
      const newDonor = await addDonor(donorData);
      console.log(`✅ Created new donor from QB customer: ${donorData.name} (ID: ${qbCustomerData.Id})`);
      resolve({ ...newDonor, action: 'created' });
      
    } catch (error) {
      console.error('❌ Error syncing donor from Quickbooks:', error);
      reject(error);
    }
  });
}

// Sync multiple donors from Quickbooks customer data
function syncDonorsFromQuickbooks(qbCustomersData) {
  return new Promise(async (resolve, reject) => {
    const results = {
      created: 0,
      skipped: 0,
      errors: [],
      total: qbCustomersData.length
    };

    for (let i = 0; i < qbCustomersData.length; i++) {
      const customer = qbCustomersData[i];
      
      try {
        const result = await syncDonorFromQuickbooks(customer);
        
        if (result.action === 'created') {
          results.created++;
        } else {
          results.skipped++;
        }
        
      } catch (error) {
        console.error(`❌ Error processing customer ${i}:`, error);
        results.errors.push({
          index: i,
          customer: customer,
          error: error.message
        });
      }
    }

    console.log(`📊 Donor sync complete: ${results.created} created, ${results.skipped} skipped, ${results.errors.length} errors`);
    resolve(results);
  });
}

// Process donor creation from transaction with customer ID
async function processDonorFromTransaction(transactionData, quickbooksAPI, organizationId) {
  return new Promise(async (resolve, reject) => {
    try {
      if (!transactionData.name_id) {
        console.log(`⚠️  No customer ID found in transaction, skipping donor creation`);
        resolve({ action: 'skipped', reason: 'no_customer_id' });
        return;
      }

      const customerId = transactionData.name_id;
      const customerName = transactionData.name;

      console.log(`🔄 Processing donor creation for transaction: ${customerName} (ID: ${customerId}) in organization: ${organizationId}`);

      // Check if donor already exists by customer ID and organization ID
      const existingDonor = await getDonorByQbCustomerId(customerId, organizationId);
      if (existingDonor) {
        console.log(`⏭️  Donor already exists for customer ID: ${customerId} (${customerName}) in organization: ${organizationId}`);
        resolve({ action: 'skipped', reason: 'donor_exists', donor: existingDonor });
        return;
      }

      // Query Quickbooks for customer information
      console.log(`🔍 Querying Quickbooks for customer ID: ${customerId}`);
      const qbCustomer = await quickbooksAPI.getCustomerById(customerId);

      // Create donor from Quickbooks customer data
      const syncResult = await syncDonorFromQuickbooks(qbCustomer, organizationId);
      console.log(`✅ Donor creation result: ${syncResult.action}`);

      // If donor was created, update the transaction with the donor_id
      if (syncResult.action === 'created' && syncResult.donor && transactionData.id) {
        console.log(`🔗 Linking transaction ${transactionData.id} to donor ${syncResult.donor.id}`);
        await updateTransactionDonorId(transactionData.id, syncResult.donor.id);
      }

      resolve(syncResult);

    } catch (error) {
      console.error(`❌ Error processing donor from transaction:`, error);
      reject(error);
    }
  });
}

// ===== RECEIPT DATABASE FUNCTIONS =====

// Add new receipt
function addReceipt(receiptData) {
  return new Promise((resolve, reject) => {
    const sql = 'INSERT INTO receipts (companyid, donorid, receipt_blob, transaction_id) VALUES (?, ?, ?, ?)';
    const params = [
      receiptData.companyid || null,
      receiptData.donorid || null,
      receiptData.receipt_blob,
      receiptData.transaction_id
    ];
    
    db.run(sql, params, function(err) {
      if (err) {
        console.error('❌ Error adding receipt:', err);
        reject(err);
      } else {
        console.log(`✅ Receipt added with ID: ${this.lastID}`);
        resolve({ id: this.lastID, ...receiptData });
      }
    });
  });
}

// Get receipt by ID
function getReceiptById(id) {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM receipts WHERE id = ?';
    
    db.get(sql, [id], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

// Get receipt by transaction ID
function getReceiptByTransactionId(transactionId) {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM receipts WHERE transaction_id = ?';
    
    db.get(sql, [transactionId], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

// Get all receipts for a donor
function getReceiptsByDonorId(donorId) {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM receipts WHERE donorid = ? ORDER BY dategenerated DESC';
    
    db.all(sql, [donorId], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// Get all receipts
function getAllReceipts() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT 
        r.*,
        d.name as donor_name,
        d.email as donor_email,
        t.amount as transaction_amount,
        t.date as transaction_date
      FROM receipts r
      LEFT JOIN donors d ON r.donorid = d.id
      LEFT JOIN transactions t ON r.transaction_id = t.id
      ORDER BY r.dategenerated DESC
    `;
    
    db.all(sql, [], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// Update receipt sent date
function updateReceiptSentDate(receiptId, sentDate) {
  return new Promise((resolve, reject) => {
    const sql = 'UPDATE receipts SET datesent = ? WHERE id = ?';
    const params = [sentDate, receiptId];
    
    db.run(sql, params, function(err) {
      if (err) {
        console.error('❌ Error updating receipt sent date:', err);
        reject(err);
      } else {
        console.log(`✅ Receipt ${receiptId} sent date updated`);
        resolve({ id: receiptId, datesent: sentDate });
      }
    });
  });
}

// Update receipt
function updateReceipt(receiptId, receiptData) {
  return new Promise((resolve, reject) => {
    const sql = 'UPDATE receipts SET companyid = ?, donorid = ?, receipt_blob = ?, transaction_id = ?, dategenerated = CURRENT_TIMESTAMP WHERE id = ?';
    const params = [
      receiptData.companyid,
      receiptData.donorid,
      receiptData.receipt_blob,
      receiptData.transaction_id,
      receiptId
    ];
    
    db.run(sql, params, function(err) {
      if (err) {
        console.error('❌ Error updating receipt:', err);
        reject(err);
      } else {
        console.log(`✅ Receipt ${receiptId} updated`);
        resolve({ id: receiptId, ...receiptData });
      }
    });
  });
}

// Delete receipt
function deleteReceipt(id) {
  return new Promise((resolve, reject) => {
    const sql = 'DELETE FROM receipts WHERE id = ?';
    
    db.run(sql, [id], function(err) {
      if (err) {
        reject(err);
      } else {
        if (this.changes > 0) {
          resolve({ deleted: true, id });
        } else {
          resolve({ deleted: false, id });
        }
      }
    });
  });
}

// ===== ORGANIZATION MANAGEMENT FUNCTIONS =====

// Get all organizations
function getAllOrganizations() {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM organizations ORDER BY name ASC';
    console.log('🔍 Executing SQL:', sql);
    
    db.all(sql, [], (err, rows) => {
      if (err) {
        console.error('❌ Database error:', err);
        reject(err);
      } else {
        console.log('📊 Raw database rows:', rows);
        // Decrypt EIN for each organization
        const decryptedRows = rows.map(row => {
          if (row.ein) {
            try {
              row.ein = Encryption.decrypt(row.ein);
            } catch (error) {
              console.error('❌ Error decrypting EIN for organization', row.id, ':', error);
              row.ein = null;
            }
          }
          return row;
        });
        console.log('🔓 Decrypted rows:', decryptedRows);
        resolve(decryptedRows);
      }
    });
  });
}

// Add new organization
function addOrganization(organizationData) {
  return new Promise((resolve, reject) => {
    // Encrypt EIN if provided
    const encryptedEin = organizationData.ein ? Encryption.encrypt(organizationData.ein) : null;
    
    const sql = 'INSERT INTO organizations (name, ein, address, city, state, zip, email, phone, contact, type, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    const params = [
      organizationData.name,
      encryptedEin,
      organizationData.address || null,
      organizationData.city || null,
      organizationData.state || null,
      organizationData.zip || null,
      organizationData.email || null,
      organizationData.phone || null,
      organizationData.contact || null,
      organizationData.type || null,
      organizationData.url || null
    ];
    
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ id: this.lastID, ...organizationData });
      }
    });
  });
}

// Update organization
function updateOrganization(id, organizationData) {
  return new Promise((resolve, reject) => {
    // Encrypt EIN if provided
    const encryptedEin = organizationData.ein ? Encryption.encrypt(organizationData.ein) : null;
    
    const sql = 'UPDATE organizations SET name = ?, ein = ?, address = ?, city = ?, state = ?, zip = ?, email = ?, phone = ?, contact = ?, type = ?, url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
    const params = [
      organizationData.name,
      encryptedEin,
      organizationData.address || null,
      organizationData.city || null,
      organizationData.state || null,
      organizationData.zip || null,
      organizationData.email || null,
      organizationData.phone || null,
      organizationData.contact || null,
      organizationData.type || null,
      organizationData.url || null,
      id
    ];
    
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ id, ...organizationData });
      }
    });
  });
}

// Delete organization
function deleteOrganization(id) {
  return new Promise((resolve, reject) => {
    const sql = 'DELETE FROM organizations WHERE id = ?';
    
    db.run(sql, [id], function(err) {
      if (err) {
        reject(err);
      } else {
        if (this.changes > 0) {
          resolve({ deleted: true, id });
        } else {
          resolve({ deleted: false, id });
        }
      }
    });
  });
}

// Get organization by ID
function getOrganizationById(id) {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM organizations WHERE id = ?';
    
    db.get(sql, [id], (err, row) => {
      if (err) {
        reject(err);
      } else {
        // Decrypt EIN if present
        if (row && row.ein) {
          try {
            row.ein = Encryption.decrypt(row.ein);
          } catch (error) {
            console.error('❌ Error decrypting EIN for organization', id, ':', error);
            row.ein = null;
          }
        }
        resolve(row);
      }
    });
  });
}

// Get organization by EIN
function getOrganizationByEin(ein) {
  return new Promise((resolve, reject) => {
    // Since EIN is encrypted, we need to get all organizations and decrypt to find match
    const sql = 'SELECT * FROM organizations';
    
    db.all(sql, [], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        // Find organization with matching decrypted EIN
        const matchingOrg = rows.find(row => {
          if (row.ein) {
            try {
              const decryptedEin = Encryption.decrypt(row.ein);
              return decryptedEin === ein;
            } catch (error) {
              console.error('❌ Error decrypting EIN for organization', row.id, ':', error);
              return false;
            }
          }
          return false;
        });
        
        // Decrypt EIN for the matching organization
        if (matchingOrg && matchingOrg.ein) {
          try {
            matchingOrg.ein = Encryption.decrypt(matchingOrg.ein);
          } catch (error) {
            console.error('❌ Error decrypting EIN for organization', matchingOrg.id, ':', error);
            matchingOrg.ein = null;
          }
        }
        
        resolve(matchingOrg || null);
      }
    });
  });
}

// Check if organization exists by EIN
function checkOrganizationExists(ein) {
  return new Promise((resolve, reject) => {
    if (!ein) {
      resolve(false);
      return;
    }
    
    // Since EIN is encrypted, we need to get all organizations and decrypt to check
    const sql = 'SELECT ein FROM organizations';
    db.all(sql, [], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        // Check if any organization has the matching decrypted EIN
        const exists = rows.some(row => {
          if (row.ein) {
            try {
              const decryptedEin = Encryption.decrypt(row.ein);
              return decryptedEin === ein;
            } catch (error) {
              console.error('❌ Error decrypting EIN for organization check:', error);
              return false;
            }
          }
          return false;
        });
        resolve(exists);
      }
    });
  });
}

// Get organization by QuickBooks organization ID
function getOrganizationByQbId(qbOrganizationId) {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM organizations WHERE qborganizationid = ?';
    db.get(sql, [qbOrganizationId], (err, row) => {
      if (err) {
        reject(err);
      } else {
        // Decrypt EIN if present
        if (row && row.ein) {
          try {
            row.ein = Encryption.decrypt(row.ein);
          } catch (error) {
            console.error('❌ Error decrypting EIN for organization', row.id, ':', error);
            row.ein = null;
          }
        }
        resolve(row);
      }
    });
  });
}

// Sync organization data from QuickBooks company info
function syncOrganizationFromQuickbooks(qbCompanyInfo, qbOrganizationId) {
  return new Promise((resolve, reject) => {
    try {
      // Map QuickBooks company fields to organization table fields
      const organizationData = {
        qborganizationid: qbOrganizationId,
        name: qbCompanyInfo.CompanyName || 'Unknown Organization',
        address: qbCompanyInfo.CompanyAddr?.Line1 || null,
        city: qbCompanyInfo.CompanyAddr?.City || null,
        state: qbCompanyInfo.CompanyAddr?.CountrySubDivisionCode || null,
        zip: qbCompanyInfo.CompanyAddr?.PostalCode || null,
        ein: qbCompanyInfo.EmployerId ? Encryption.encrypt(qbCompanyInfo.EmployerId) : null,
        phone: qbCompanyInfo.PrimaryPhone?.FreeFormNumber || null,
        url: qbCompanyInfo.WebAddr?.URI || null,
        type: 'Non-Profit', // Default type
        contact: 'QuickBooks Sync', // Default contact
        email: qbCompanyInfo.Email?.Address || null
      };

      console.log('🔍 Raw QuickBooks company info response:', JSON.stringify(qbCompanyInfo, null, 2));
      console.log('📋 Mapping QB company data to organization:', {
        qborganizationid: organizationData.qborganizationid,
        name: organizationData.name,
        address: organizationData.address,
        city: organizationData.city,
        state: organizationData.state,
        zip: organizationData.zip,
        ein: organizationData.ein ? '[ENCRYPTED]' : null,
        phone: organizationData.phone,
        email: organizationData.email,
        url: organizationData.url
      });

      // Insert new organization
      const sql = `INSERT INTO organizations (
        qborganizationid, name, address, city, state, zip, 
        ein, phone, url, type, contact, email, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
      
      const params = [
        organizationData.qborganizationid,
        organizationData.name,
        organizationData.address,
        organizationData.city,
        organizationData.state,
        organizationData.zip,
        organizationData.ein,
        organizationData.phone,
        organizationData.url,
        organizationData.type,
        organizationData.contact,
        organizationData.email
      ];

      db.run(sql, params, function(err) {
        if (err) {
          console.error('❌ Error creating organization from QuickBooks:', err);
          reject(err);
        } else {
          console.log(`✅ Created organization from QuickBooks: ${organizationData.name} (ID: ${this.lastID})`);
          resolve({ 
            id: this.lastID, 
            ...organizationData,
            action: 'created' 
          });
        }
      });

    } catch (error) {
      console.error('❌ Error syncing organization from QuickBooks:', error);
      reject(error);
    }
  });
}

// ===== LOGO MANAGEMENT FUNCTIONS =====

// Get all logos
function getAllLogos() {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM logos ORDER BY created_at DESC';
    console.log('🔍 Executing SQL:', sql);
    
    db.all(sql, [], (err, rows) => {
      if (err) {
        console.error('❌ Database error:', err);
        reject(err);
      } else {
        console.log('📊 Raw database rows:', rows);
        resolve(rows);
      }
    });
  });
}

// Get logo by ID
function getLogoById(logoId) {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM logos WHERE LogoId = ?';
    console.log('🔍 Executing SQL:', sql, 'with params:', [logoId]);
    
    db.get(sql, [logoId], (err, row) => {
      if (err) {
        console.error('❌ Database error:', err);
        reject(err);
      } else {
        console.log('📊 Raw database row:', row);
        resolve(row);
      }
    });
  });
}

// Get logo by organization ID
function getLogoByOrganizationId(organizationId) {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM logos WHERE organizationId = ?';
    console.log('🔍 Executing SQL:', sql, 'with params:', [organizationId]);
    
    db.get(sql, [organizationId], (err, row) => {
      if (err) {
        console.error('❌ Database error:', err);
        reject(err);
      } else {
        console.log('📊 Raw database row:', row);
        if (row && row.Logo) {
          console.log('📊 Logo data type:', typeof row.Logo);
          console.log('📊 Logo data length:', row.Logo.length);
        }
        resolve(row);
      }
    });
  });
}

// Add new logo
function addLogo(logoData) {
  return new Promise((resolve, reject) => {
    const sql = 'INSERT INTO logos (Logo, logofilename, logoposition, width, height, organizationId) VALUES (?, ?, ?, ?, ?, ?)';
    
    // Convert array to Buffer for proper BLOB storage
    let logoBuffer = null;
    if (logoData.Logo && Array.isArray(logoData.Logo)) {
      logoBuffer = Buffer.from(logoData.Logo);
    }
    
    const params = [
      logoBuffer,
      logoData.logofilename || null,
      logoData.logoposition || null,
      logoData.width || null,
      logoData.height || null,
      logoData.organizationId || null
    ];
    
    console.log('🔍 Executing SQL:', sql, 'with params:', params.slice(0, 2), '... (logo buffer length:', logoBuffer ? logoBuffer.length : 'null', ')');
    
    db.run(sql, params, function(err) {
      if (err) {
        console.error('❌ Database error:', err);
        reject(err);
      } else {
        console.log('✅ Logo added with ID:', this.lastID);
        resolve({ LogoId: this.lastID, ...logoData });
      }
    });
  });
}

// Update logo
function updateLogo(logoId, logoData) {
  return new Promise((resolve, reject) => {
    const sql = 'UPDATE logos SET Logo = ?, logofilename = ?, logoposition = ?, width = ?, height = ?, organizationId = ?, updated_at = CURRENT_TIMESTAMP WHERE LogoId = ?';
    
    // Convert array to Buffer for proper BLOB storage
    let logoBuffer = null;
    if (logoData.Logo && Array.isArray(logoData.Logo)) {
      logoBuffer = Buffer.from(logoData.Logo);
    }
    
    const params = [
      logoBuffer,
      logoData.logofilename || null,
      logoData.logoposition || null,
      logoData.width || null,
      logoData.height || null,
      logoData.organizationId || null,
      logoId
    ];
    
    console.log('🔍 Executing SQL:', sql, 'with params:', params.slice(0, 2), '... (logo buffer length:', logoBuffer ? logoBuffer.length : 'null', ')');
    
    db.run(sql, params, function(err) {
      if (err) {
        console.error('❌ Database error:', err);
        reject(err);
      } else {
        console.log('✅ Logo updated:', logoId);
        resolve({ LogoId: logoId, ...logoData });
      }
    });
  });
}

// Delete logo
function deleteLogo(logoId) {
  return new Promise((resolve, reject) => {
    const sql = 'DELETE FROM logos WHERE LogoId = ?';
    console.log('🔍 Executing SQL:', sql, 'with params:', [logoId]);
    
    db.run(sql, [logoId], function(err) {
      if (err) {
        console.error('❌ Database error:', err);
        reject(err);
      } else {
        if (this.changes > 0) {
          console.log('✅ Logo deleted:', logoId);
          resolve({ deleted: true, LogoId: logoId });
        } else {
          console.log('⚠️ No logo found with ID:', logoId);
          resolve({ deleted: false, LogoId: logoId });
        }
      }
    });
  });
}

// Delete logo by organization ID
function deleteLogoByOrganizationId(organizationId) {
  return new Promise((resolve, reject) => {
    const sql = 'DELETE FROM logos WHERE organizationId = ?';
    console.log('🔍 Executing SQL:', sql, 'with params:', [organizationId]);
    
    db.run(sql, [organizationId], function(err) {
      if (err) {
        console.error('❌ Database error:', err);
        reject(err);
      } else {
        if (this.changes > 0) {
          console.log('✅ Logo deleted for organization:', organizationId);
          resolve({ deleted: true, organizationId: organizationId });
        } else {
          console.log('⚠️ No logo found for organization:', organizationId);
          resolve({ deleted: false, organizationId: organizationId });
        }
      }
    });
  });
}

// ===== QUICKBOOKS INTEGRATION FUNCTIONS =====

// Parse QuickBooks SalesReceipt and populate transaction items
function populateTransactionItemsFromQuickbooks(salesReceiptData, transactionId) {
  return new Promise(async (resolve, reject) => {
    try {
      console.log(`🔄 Processing QuickBooks SalesReceipt for transaction ${transactionId}`);
      
      if (!salesReceiptData || !salesReceiptData.Line || !Array.isArray(salesReceiptData.Line)) {
        console.log('⚠️ No line items found in SalesReceipt data');
        resolve({ processed: 0, skipped: 0 });
        return;
      }
      
      let processed = 0;
      let skipped = 0;
      
      // Process each line item
      for (const line of salesReceiptData.Line) {
        // Skip non-item lines (like SubTotalLineDetail)
        if (line.DetailType !== 'SalesItemLineDetail' || !line.SalesItemLineDetail) {
          console.log(`⏭️ Skipping non-item line: ${line.DetailType}`);
          skipped++;
          continue;
        }
        
        const salesItemDetail = line.SalesItemLineDetail;
        
        // Extract item data
        const itemData = {
          description: line.Description || 'No Description',
          quantity: salesItemDetail.Qty || 1,
          transactionId: transactionId,
          amount: line.Amount || 0,
          lineNum: line.LineNum !== undefined ? line.LineNum : null,
          unitPrice: salesItemDetail.UnitPrice !== undefined ? salesItemDetail.UnitPrice : null
        };
        
        console.log(`📋 Processing item: "${itemData.description}" - LineNum: ${itemData.lineNum}, Qty: ${itemData.quantity}, UnitPrice: ${itemData.unitPrice}, Amount: ${itemData.amount}`);
        console.log(`🔍 Debug - salesItemDetail.UnitPrice:`, salesItemDetail.UnitPrice, `(type: ${typeof salesItemDetail.UnitPrice})`);
        
        try {
          // Add the transaction item
          await addTransactionItem(itemData);
          processed++;
          console.log(`✅ Added transaction item: "${itemData.description}"`);
        } catch (error) {
          console.error(`❌ Error adding transaction item:`, error);
          skipped++;
        }
      }
      
      console.log(`📊 QuickBooks SalesReceipt processing complete: ${processed} items added, ${skipped} skipped`);
      resolve({ processed, skipped });
      
    } catch (error) {
      console.error('❌ Error processing QuickBooks SalesReceipt:', error);
      reject(error);
    }
  });
}

// Process multiple QuickBooks SalesReceipts
function populateTransactionItemsFromMultipleQuickbooks(salesReceiptsData) {
  return new Promise(async (resolve, reject) => {
    try {
      console.log(`🔄 Processing ${salesReceiptsData.length} QuickBooks SalesReceipts`);
      
      const results = {
        processed: 0,
        skipped: 0,
        errors: [],
        total: salesReceiptsData.length
      };
      
      for (const salesReceipt of salesReceiptsData) {
        try {
          // Find the corresponding transaction by DocNumber
          const transaction = await findTransactionByQbDocNum(salesReceipt.DocNumber);
          
          if (!transaction) {
            console.log(`⚠️ No transaction found for QB DocNumber: ${salesReceipt.DocNumber}`);
            results.skipped++;
            continue;
          }
          
          // Check if transaction items already exist
          const existingItems = await getTransactionItemsByTransactionId(transaction.id);
          if (existingItems.length > 0) {
            console.log(`⏭️ Transaction ${transaction.id} already has ${existingItems.length} items, skipping`);
            results.skipped++;
            continue;
          }
          
          // Populate transaction items
          const itemResult = await populateTransactionItemsFromQuickbooks(salesReceipt, transaction.id);
          results.processed += itemResult.processed;
          results.skipped += itemResult.skipped;
          
        } catch (error) {
          console.error(`❌ Error processing SalesReceipt ${salesReceipt.DocNumber}:`, error);
          results.errors.push({
            docNumber: salesReceipt.DocNumber,
            error: error.message
          });
        }
      }
      
      console.log(`📊 QuickBooks SalesReceipts processing complete: ${results.processed} items added, ${results.skipped} skipped, ${results.errors.length} errors`);
      resolve(results);
      
    } catch (error) {
      console.error('❌ Error processing QuickBooks SalesReceipts:', error);
      reject(error);
    }
  });
}

// Import transactions from QuickBooks SalesReceipt data (creates new transactions)
function importTransactionsFromQuickbooks(salesReceiptsData, organizationId = 1) {
  return new Promise(async (resolve, reject) => {
    try {
      console.log(`🔄 Importing ${salesReceiptsData.length} transactions from QuickBooks SalesReceipts`);
      
      const results = {
        transactionsCreated: 0,
        donorsCreated: 0,
        itemsCreated: 0,
        skipped: 0,
        errors: [],
        total: salesReceiptsData.length
      };
      
      for (const salesReceipt of salesReceiptsData) {
        try {
          console.log(`📋 Processing SalesReceipt: ${salesReceipt.DocNumber}`);
          
          // Check if transaction already exists
          const existingTransaction = await findTransactionByQbDocNum(salesReceipt.DocNumber);
          if (existingTransaction) {
            console.log(`⏭️ Transaction ${salesReceipt.DocNumber} already exists, skipping`);
            results.skipped++;
            continue;
          }
          
          // Extract customer information
          let donorId = null;
          if (salesReceipt.CustomerRef && salesReceipt.CustomerRef.value) {
            // Try to find existing donor by QB customer ID
            const existingDonor = await getDonorByQbCustomerId(salesReceipt.CustomerRef.value);
            if (existingDonor) {
              donorId = existingDonor.id;
              console.log(`✅ Found existing donor: ${existingDonor.name} (ID: ${donorId})`);
            } else {
              // Create new donor from customer data
              // Note: We'll need the full customer data from QB API for this
              console.log(`⚠️ Need to create donor for QB customer ID: ${salesReceipt.CustomerRef.value}`);
              // For now, we'll create a placeholder donor
              const donorData = {
                name: salesReceipt.CustomerRef.name || `Customer ${salesReceipt.CustomerRef.value}`,
                email: null,
                qb_customer_id: salesReceipt.CustomerRef.value
              };
              
              try {
                const newDonor = await addDonor(donorData);
                donorId = newDonor.id;
                results.donorsCreated++;
                console.log(`✅ Created new donor: ${donorData.name} (ID: ${donorId})`);
              } catch (error) {
                console.error(`❌ Error creating donor:`, error);
                // Continue without donor
              }
            }
          }
          
          // Calculate total amount from line items
          let totalAmount = 0;
          if (salesReceipt.Line && Array.isArray(salesReceipt.Line)) {
            for (const line of salesReceipt.Line) {
              if (line.DetailType === 'SalesItemLineDetail' && line.Amount) {
                totalAmount += parseFloat(line.Amount) || 0;
              }
            }
          }
          
          // Create transaction
          const transactionData = {
            date: salesReceipt.TxnDate || new Date().toISOString().split('T')[0],
            donor_id: donorId,
            amount: totalAmount,
            qb_docnum: salesReceipt.DocNumber,
            organizationId: organizationId
          };
          
          console.log(`💾 Creating transaction: ${transactionData.qb_docnum} - Amount: $${transactionData.amount}`);
          
          const newTransaction = await addQuickbooksTransaction(transactionData);
          results.transactionsCreated++;
          console.log(`✅ Created transaction: ${newTransaction.id}`);
          
          // Add transaction items
          if (salesReceipt.Line && Array.isArray(salesReceipt.Line)) {
            const itemResult = await populateTransactionItemsFromQuickbooks(salesReceipt, newTransaction.id);
            results.itemsCreated += itemResult.processed;
          }
          
        } catch (error) {
          console.error(`❌ Error importing SalesReceipt ${salesReceipt.DocNumber}:`, error);
          results.errors.push({
            docNumber: salesReceipt.DocNumber,
            error: error.message
          });
        }
      }
      
      console.log(`📊 Import complete: ${results.transactionsCreated} transactions, ${results.donorsCreated} donors, ${results.itemsCreated} items created, ${results.skipped} skipped, ${results.errors.length} errors`);
      resolve(results);
      
    } catch (error) {
      console.error('❌ Error importing transactions from QuickBooks:', error);
      reject(error);
    }
  });
}

// Helper function to find transaction by QuickBooks DocNumber
function findTransactionByQbDocNum(qbDocNum) {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM transactions WHERE qb_docnum = ?';
    
    db.get(sql, [qbDocNum], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

// ===== TRANSACTION ITEMS MANAGEMENT FUNCTIONS =====

// Get all transaction items
function getAllTransactionItems() {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM transaction_items ORDER BY created_at DESC';
    
    db.all(sql, [], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// Get transaction items by transaction ID
function getTransactionItemsByTransactionId(transactionId) {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM transaction_items WHERE transactionId = ? ORDER BY created_at ASC';
    
    db.all(sql, [transactionId], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// Get transaction item by ID
function getTransactionItemById(id) {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM transaction_items WHERE id = ?';
    
    db.get(sql, [id], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

// Add new transaction item
function addTransactionItem(itemData) {
  return new Promise(async (resolve, reject) => {
    const sql = 'INSERT INTO transaction_items (description, quantity, transactionId, amount, lineNum, unitPrice) VALUES (?, ?, ?, ?, ?, ?)';
    const params = [
      itemData.description,
      itemData.quantity || 1,
      itemData.transactionId,
      itemData.amount,
      itemData.lineNum || null,
      itemData.unitPrice || null
    ];
    
    db.run(sql, params, async function(err) {
      if (err) {
        reject(err);
        return;
      }
      
      const newItem = { id: this.lastID, ...itemData };
      
      // Update the transaction amount
      try {
        await updateTransactionAmountFromItems(itemData.transactionId);
        resolve(newItem);
      } catch (updateErr) {
        console.error('Error updating transaction amount:', updateErr);
        // Still resolve with the item even if amount update fails
        resolve(newItem);
      }
    });
  });
}

// Update transaction item
function updateTransactionItem(id, itemData) {
  return new Promise(async (resolve, reject) => {
    // First get the transactionId for this item
    const getSql = 'SELECT transactionId FROM transaction_items WHERE id = ?';
    
    db.get(getSql, [id], async (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      
      if (!row) {
        reject(new Error('Transaction item not found'));
        return;
      }
      
      const transactionId = row.transactionId;
      
      const sql = 'UPDATE transaction_items SET description = ?, quantity = ?, amount = ?, lineNum = ?, unitPrice = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
      const params = [
        itemData.description,
        itemData.quantity,
        itemData.amount,
        itemData.lineNum || null,
        itemData.unitPrice || null,
        id
      ];
      
      db.run(sql, params, async function(err) {
        if (err) {
          reject(err);
          return;
        }
        
        const updatedItem = { id, ...itemData };
        
        // Update the transaction amount
        try {
          await updateTransactionAmountFromItems(transactionId);
          resolve(updatedItem);
        } catch (updateErr) {
          console.error('Error updating transaction amount:', updateErr);
          // Still resolve with the item even if amount update fails
          resolve(updatedItem);
        }
      });
    });
  });
}

// Delete transaction item
function deleteTransactionItem(id) {
  return new Promise(async (resolve, reject) => {
    // First get the transactionId for this item
    const getSql = 'SELECT transactionId FROM transaction_items WHERE id = ?';
    
    db.get(getSql, [id], async (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      
      if (!row) {
        reject(new Error('Transaction item not found'));
        return;
      }
      
      const transactionId = row.transactionId;
      
      const sql = 'DELETE FROM transaction_items WHERE id = ?';
      
      db.run(sql, [id], async function(err) {
        if (err) {
          reject(err);
          return;
        }
        
        const result = { deleted: this.changes > 0 };
        
        // Update the transaction amount
        try {
          await updateTransactionAmountFromItems(transactionId);
          resolve(result);
        } catch (updateErr) {
          console.error('Error updating transaction amount:', updateErr);
          // Still resolve with the result even if amount update fails
          resolve(result);
        }
      });
    });
  });
}

// Delete all transaction items for a transaction
function deleteTransactionItemsByTransactionId(transactionId) {
  return new Promise((resolve, reject) => {
    const sql = 'DELETE FROM transaction_items WHERE transactionId = ?';
    
    db.run(sql, [transactionId], function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ deleted: this.changes > 0, count: this.changes });
      }
    });
  });
}

// Calculate and update transaction amount from items
function updateTransactionAmountFromItems(transactionId) {
  return new Promise((resolve, reject) => {
    // Get sum of all items for this transaction
    const sumSql = 'SELECT COALESCE(SUM(amount), 0) as total FROM transaction_items WHERE transactionId = ?';
    
    db.get(sumSql, [transactionId], (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      
      const newAmount = result.total;
      
      // Update the transaction amount
      const updateSql = 'UPDATE transactions SET amount = ? WHERE id = ?';
      db.run(updateSql, [newAmount, transactionId], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ transactionId, newAmount, updated: this.changes > 0 });
        }
      });
    });
  });
}

// ===== FEEDBACK MANAGEMENT FUNCTIONS =====

// Get all feedback
function getAllFeedback() {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM feedback ORDER BY created_at DESC';
    
    db.all(sql, [], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// Get feedback by ID
function getFeedbackById(id) {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM feedback WHERE id = ?';
    
    db.get(sql, [id], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

// Get feedback by organization ID
function getFeedbackByOrganizationId(organizationId) {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM feedback WHERE organizationId = ? ORDER BY created_at DESC';
    
    db.all(sql, [organizationId], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// Add new feedback
function addFeedback(feedbackData) {
  return new Promise((resolve, reject) => {
    const sql = 'INSERT INTO feedback (organizationId, feedback, email, rating) VALUES (?, ?, ?, ?)';
    const params = [
      feedbackData.organizationId || null,
      feedbackData.feedback,
      feedbackData.email || null,
      feedbackData.rating
    ];
    
    db.run(sql, params, function(err) {
      if (err) {
        console.error('❌ Error adding feedback:', err);
        reject(err);
      } else {
        console.log(`✅ Feedback added with ID: ${this.lastID}`);
        resolve({ id: this.lastID, ...feedbackData });
      }
    });
  });
}

// Delete feedback
function deleteFeedback(id) {
  return new Promise((resolve, reject) => {
    const sql = 'DELETE FROM feedback WHERE id = ?';
    
    db.run(sql, [id], function(err) {
      if (err) {
        reject(err);
      } else {
        if (this.changes > 0) {
          resolve({ deleted: true, id });
        } else {
          resolve({ deleted: false, id });
        }
      }
    });
  });
}

// ===== OPTIONS FUNCTIONS =====

// Get option by organizationId and key
function getOption(organizationId, key) {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM options WHERE organizationId = ? AND key = ?';
    db.get(sql, [organizationId, key], (err, row) => {
      if (err) {
        console.error('❌ Error getting option:', err);
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

// Get all options for an organization
function getOptionsByOrganizationId(organizationId) {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM options WHERE organizationId = ?';
    db.all(sql, [organizationId], (err, rows) => {
      if (err) {
        console.error('❌ Error getting options:', err);
        reject(err);
      } else {
        resolve(rows || []);
      }
    });
  });
}

// Set option (insert or update)
function setOption(organizationId, key, value) {
  return new Promise((resolve, reject) => {
    // First check if option exists
    getOption(organizationId, key)
      .then(existingOption => {
        if (existingOption) {
          // Update existing option
          const sql = 'UPDATE options SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE organizationId = ? AND key = ?';
          db.run(sql, [value, organizationId, key], function(err) {
            if (err) {
              console.error('❌ Error updating option:', err);
              reject(err);
            } else {
              console.log(`✅ Updated option: ${key} = ${value} for organization ${organizationId}`);
              resolve({ organizationId, key, value });
            }
          });
        } else {
          // Insert new option
          const sql = 'INSERT INTO options (organizationId, key, value) VALUES (?, ?, ?)';
          db.run(sql, [organizationId, key, value], function(err) {
            if (err) {
              console.error('❌ Error adding option:', err);
              reject(err);
            } else {
              console.log(`✅ Added option: ${key} = ${value} for organization ${organizationId}`);
              resolve({ id: this.lastID, organizationId, key, value });
            }
          });
        }
      })
      .catch(err => reject(err));
  });
}

// Delete option
function deleteOption(organizationId, key) {
  return new Promise((resolve, reject) => {
    const sql = 'DELETE FROM options WHERE organizationId = ? AND key = ?';
    
    db.run(sql, [organizationId, key], function(err) {
      if (err) {
        reject(err);
      } else {
        if (this.changes > 0) {
          console.log(`✅ Deleted option: ${key} for organization ${organizationId}`);
          resolve({ deleted: true, organizationId, key });
        } else {
          resolve({ deleted: false, organizationId, key });
        }
      }
    });
  });
}

// Close database connection
function closeDatabase() {
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('✅ Database connection closed');
    }
  });
}

module.exports = {
  getAllTransactions,
  getTransactionsByOrganizationId,
  addTransaction,
  addQuickbooksTransaction,
  addQuickbooksTransactions,
  checkTransactionExists,
  updateTransaction,
  updateTransactionDonorId,
  deleteTransaction,
  getTransactionById,
  getAllDonors,
  addDonor,
  updateDonor,
  deleteDonor,
  getDonorById,
  getDonorByQbCustomerId,
  checkDonorExists,
  syncDonorFromQuickbooks,
  syncDonorsFromQuickbooks,
  processDonorFromTransaction,
  getAllOrganizations,
  addOrganization,
  updateOrganization,
  deleteOrganization,
  getOrganizationById,
  getOrganizationByEin,
  checkOrganizationExists,
  getOrganizationByQbId,
  syncOrganizationFromQuickbooks,
  addReceipt,
  getReceiptById,
  getReceiptByTransactionId,
  getReceiptsByDonorId,
  getAllReceipts,
  updateReceipt,
  updateReceiptSentDate,
  deleteReceipt,
  getAllLogos,
  getLogoById,
  getLogoByOrganizationId,
  addLogo,
  updateLogo,
  deleteLogo,
  deleteLogoByOrganizationId,
  getAllTransactionItems,
  getTransactionItemsByTransactionId,
  getTransactionItemById,
  addTransactionItem,
  updateTransactionItem,
  deleteTransactionItem,
  deleteTransactionItemsByTransactionId,
  updateTransactionAmountFromItems,
  populateTransactionItemsFromQuickbooks,
  populateTransactionItemsFromMultipleQuickbooks,
  findTransactionByQbDocNum,
  getAllFeedback,
  getFeedbackById,
  getFeedbackByOrganizationId,
  addFeedback,
  deleteFeedback,
  getOption,
  getOptionsByOrganizationId,
  setOption,
  deleteOption,
  closeDatabase
};
