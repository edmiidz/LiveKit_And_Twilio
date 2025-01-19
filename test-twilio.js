require('dotenv').config();
const twilio = require('twilio');

async function testTwilioCredentials() {
    const client = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
    );

    try {
        // Try to fetch account info
        const account = await client.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
        console.log('Successfully authenticated with Twilio!');
        console.log('Account friendly name:', account.friendlyName);
        console.log('Account status:', account.status);
    } catch (error) {
        console.error('Failed to authenticate with Twilio:');
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        process.exit(1);
    }
}

testTwilioCredentials();