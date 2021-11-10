// Import the required modules
const crypto = require('crypto')
const {promisify} = require('util')

// Promisify the crypto.generateKeyPair and crypto.randomBytes methods
const generateKeyPair = promisify(crypto.generateKeyPair)
const randomBytes = promisify(crypto.randomBytes)

/**
 * Alice uses this function to encrypt a message with an ECIES algorithm that uses:
 * 
 * - ECDH for key agreement with Bob, to generate a shared secret
 * - SHA-256 with a random salt to derive the symmetric encryption key, stretching the shared secret
 * - AES-256-GCM as authenticated symmetric cipher to encrypt the data
 * 
 * Returns the message that Alice needs to send to Bob, which includes the salt used for SHA-256, the ciphertext, and the AES-GCM authentication tag
 * 
 * @param {crypto.KeyObject} alicePrivateKey Alice's private key
 * @param {crypto.KeyObject} bobPublicKey Bob's public key
 * @param {string} message Message to encrypt
 * @returns {Promise<Buffer>} Message that Alice needs to send to Bob
 */
 async function AliceEncrypt(alicePrivateKey, bobPublicKey, message) {
    // Alice calculates the shared secret using her own private key and Bob's public key
    const sharedSecret = crypto.diffieHellman({
        publicKey: bobPublicKey,
        privateKey: alicePrivateKey
    })

    // Because the shared secret generated by an ECDH function isn't uniformly random, we will need to stretch it to generate a 32-byte key (for AES-256-GCM), for example using SHA-256 with a random 16-byte salt as Key-Derivation Function (KDF)
    const salt = await randomBytes(16)
    const symmetricKey = crypto.createHash('sha256')
        .update(Buffer.concat([sharedSecret, salt]))
        .digest()

    // Encrypt the message using AES-256
    const encryptedMessage = await aesEncrypt(symmetricKey, message)

    // Return the concatenation of the salt used for the KDF and the encrypted message (which contains the IV and the authentication tag too)
    return Buffer.concat([salt, encryptedMessage])
}

/**
 * Bob uses this function to decrypt the message he received from Alice.
 * 
 * This function calculates the shared secret using ECDH, with Bob's private key and Alice's public key. Then it uses the same ECIES algorithm as AliceEncrypt does to decrypt the data.
 * 
 * @param {crypto.KeyObject} bobPrivateKey Bob's private key
 * @param {crypto.KeyObject} alicePublicKey Alice's public key
 * @param {Buffer} encryptedMessage Message Bob received from Alice
 * @returns {string} Decrypted message in plain-text
 */
function BobDecrypt(bobPrivateKey, alicePublicKey, encryptedMessage) {
    // Bob calculates the shared secret using his own private key and Alice's public key
    const sharedSecret = crypto.diffieHellman({
        publicKey: alicePublicKey,
        privateKey: bobPrivateKey
    })

    // The first 16 bytes of the encryptedMessage contain the salt for the KDF, which was used to stretch the sharedSecret into a symmetricKey
    const salt = encryptedMessage.slice(0, 16)
    const symmetricKey = crypto.createHash('sha256')
        .update(Buffer.concat([sharedSecret, salt]))
        .digest()

    // The remaining bytes are the message encrypted with AES-256-GCM (including the IV and authentication tag)
    return aesDecrypt(symmetricKey, encryptedMessage.slice(16))
}

// Need to wrap this in an immediately-invoked function expression (IIFE) because of async code
;(async function() {
    // Message to encrypt
    const message = 'Hello world'

    // Generate a key pair for Alice (using the x25519 curve)
    // Then export the public key as PEM
    const aliceKeyPair = await generateKeyPair('x25519')
    const alicePublicKeyPem = aliceKeyPair.publicKey.export({
        type: 'spki',
        format: 'pem'
    })

    // Generate a key pair for Bob  (using the x25519 curve)
    // Then export the public key as PEM
    const bobKeyPair = await generateKeyPair('x25519')
    const bobPublicKeyPem = bobKeyPair.publicKey.export({
        type: 'spki',
        format: 'pem'
    })

    // Alice encrypts a message so it can be sent to Bob
    const encrypted = await AliceEncrypt(
        aliceKeyPair.privateKey,
        crypto.createPublicKey(bobPublicKeyPem),
        message
    )

    // Alice transmits to Bob her public key as well as the encrypted message
    // Bob decrypts that by computing the shared secret and then reverting the encryption
    const decrypted = BobDecrypt(
        bobKeyPair.privateKey,
        crypto.createPublicKey(alicePublicKeyPem),
        encrypted
    )

    console.log('The decrypted message is:', decrypted)
})()

/** Example symmetric encryption/decryption functions from aes-256-gcm */

async function aesEncrypt(key, plaintext) {
    const iv = await randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final()
    ])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, tag, encrypted])
}

function aesDecrypt(key, message) {
    const iv = message.slice(0, 12)
    const tag = message.slice(12, 28)
    const ciphertext = message.slice(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([
        decipher.update(ciphertext, 'utf8'),
        decipher.final()
    ])
    return decrypted.toString('utf8')
}
