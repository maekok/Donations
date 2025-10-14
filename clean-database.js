const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const readline = require('readline');

// Database file path
const dbPath = path.join(__dirname, 'data.db');

// Create readline interface for user confirmation
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Function to clean the database
function cleanDatabase() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('❌ Error opening database:', err.message);
        reject(err);
        return;
      }
      
      console.log('✅ Connected to database');
      
      // Tables to clean (in order to respect foreign key constraints)
      const tables = [
        'receipts',
        'transaction_items',
        'transactions',
        'logos',
        'donors',
        'organizations',
        'users'
      ];
      
      let completedTables = 0;
      const results = {};
      
      // Disable foreign key constraints temporarily
      db.run('PRAGMA foreign_keys = OFF', (err) => {
        if (err) {
          console.error('❌ Error disabling foreign keys:', err.message);
          reject(err);
          return;
        }
        
        console.log('🔓 Foreign key constraints disabled');
        
        // Process each table
        tables.forEach((table) => {
          db.run(`DELETE FROM ${table}`, function(err) {
            if (err) {
              console.error(`❌ Error cleaning table ${table}:`, err.message);
              results[table] = { success: false, error: err.message };
            } else {
              const deletedRows = this.changes;
              console.log(`✅ Cleaned table ${table}: ${deletedRows} rows deleted`);
              results[table] = { success: true, deletedRows };
              
              // Reset the autoincrement counter
              db.run(`DELETE FROM sqlite_sequence WHERE name='${table}'`, (err) => {
                if (err && !err.message.includes('no such table')) {
                  console.error(`⚠️  Warning: Could not reset autoincrement for ${table}:`, err.message);
                } else if (!err) {
                  console.log(`🔄 Reset autoincrement counter for ${table}`);
                }
              });
            }
            
            completedTables++;
            
            // When all tables are processed
            if (completedTables === tables.length) {
              // Re-enable foreign key constraints
              db.run('PRAGMA foreign_keys = ON', (err) => {
                if (err) {
                  console.error('❌ Error re-enabling foreign keys:', err.message);
                } else {
                  console.log('🔒 Foreign key constraints re-enabled');
                }
                
                // Close database connection
                db.close((err) => {
                  if (err) {
                    console.error('❌ Error closing database:', err.message);
                    reject(err);
                  } else {
                    console.log('✅ Database connection closed');
                    console.log('\n📊 Summary:');
                    let totalDeleted = 0;
                    tables.forEach(table => {
                      if (results[table].success) {
                        console.log(`   ${table}: ${results[table].deletedRows} rows deleted`);
                        totalDeleted += results[table].deletedRows;
                      } else {
                        console.log(`   ${table}: FAILED - ${results[table].error}`);
                      }
                    });
                    console.log(`\n   Total: ${totalDeleted} rows deleted across all tables`);
                    console.log('\n✨ Database cleaned successfully!');
                    resolve(results);
                  }
                });
              });
            }
          });
        });
      });
    });
  });
}

// Main execution
console.log('⚠️  WARNING: This will delete ALL data from the database!');
console.log('📋 Tables that will be cleaned:');
console.log('   - receipts');
console.log('   - transaction_items');
console.log('   - transactions');
console.log('   - logos');
console.log('   - donors');
console.log('   - organizations');
console.log('   - users');
console.log('');

rl.question('Are you sure you want to continue? (yes/no): ', (answer) => {
  if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
    console.log('\n🧹 Starting database cleanup...\n');
    cleanDatabase()
      .then(() => {
        rl.close();
        process.exit(0);
      })
      .catch((err) => {
        console.error('\n❌ Database cleanup failed:', err);
        rl.close();
        process.exit(1);
      });
  } else {
    console.log('\n❌ Database cleanup cancelled');
    rl.close();
    process.exit(0);
  }
});

