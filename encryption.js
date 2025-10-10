const CryptoJS = require('crypto-js');

// Encryption key - in production, this should be stored in environment variables
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'your-secret-encryption-key-change-in-production';

class Encryption {
  /**
   * Encrypt sensitive data
   * @param {string} text - Text to encrypt
   * @returns {string} - Encrypted text
   */
  static encrypt(text) {
    if (!text) return null;
    
    try {
      const encrypted = CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
      return encrypted;
    } catch (error) {
      console.error('❌ Encryption error:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypt sensitive data
   * @param {string} encryptedText - Encrypted text to decrypt
   * @returns {string} - Decrypted text
   */
  static decrypt(encryptedText) {
    if (!encryptedText) return null;
    
    try {
      const decrypted = CryptoJS.AES.decrypt(encryptedText, ENCRYPTION_KEY);
      return decrypted.toString(CryptoJS.enc.Utf8);
    } catch (error) {
      console.error('❌ Decryption error:', error);
      throw new Error('Failed to decrypt data');
    }
  }

  /**
   * Check if text is encrypted
   * @param {string} text - Text to check
   * @returns {boolean} - True if encrypted
   */
  static isEncrypted(text) {
    if (!text) return false;
    
    try {
      // Try to decrypt - if it works, it's encrypted
      const decrypted = CryptoJS.AES.decrypt(text, ENCRYPTION_KEY);
      const result = decrypted.toString(CryptoJS.enc.Utf8);
      return result !== '';
    } catch (error) {
      return false;
    }
  }

  /**
   * Safely encrypt text only if it's not already encrypted
   * @param {string} text - Text to encrypt
   * @returns {string} - Encrypted text
   */
  static safeEncrypt(text) {
    if (!text) return null;
    
    // If already encrypted, return as is
    if (this.isEncrypted(text)) {
      return text;
    }
    
    return this.encrypt(text);
  }
}

module.exports = Encryption; 