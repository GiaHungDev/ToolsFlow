const crypto = require('crypto');

// Use a secure key generation approach for production
// For now, we use a fixed secret or preferably from ENV variables.
// The key must be 32 bytes (256 bits) for aes-256-cbc.
const ENCRYPTION_KEY = process.env.VEO_ENCRYPTION_KEY || 'veo3_auto_secret_key_12345678901'; // Fallback 32 chars
const IV_LENGTH = 16; // For AES, this is always 16

function encrypt(text) {
    if (!text) return text;

    // Ensure the key is exactly 32 bytes long
    const key = crypto.createHash('sha256').update(String(ENCRYPTION_KEY)).digest('base64').substring(0, 32);

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
    if (!text || typeof text !== 'string') return text;
    // Nếu text không có dạng iv:hex (không chứa dấu :) thì đây là plaintext thuần
    if (!text.includes(':')) {
        return text;
    }
    try {
        // Ensure the key is exactly 32 bytes long
        const key = crypto.createHash('sha256').update(String(ENCRYPTION_KEY)).digest('base64').substring(0, 32);

        const textParts = text.split(':');
        if (textParts.length !== 2) return text;
        const iv = Buffer.from(textParts[0], 'hex');
        const encryptedText = Buffer.from(textParts[1], 'hex');
        if (iv.length !== IV_LENGTH) return text;

        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);

        return decrypted.toString('utf8');
    } catch (e) {
        // Fallback: nếu giải mã không thành công thì trả về chuỗi gốc
        return text;
    }
}

module.exports = {
    encrypt,
    decrypt
};
