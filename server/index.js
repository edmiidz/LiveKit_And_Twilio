const result = require('dotenv').config();
if (result.error) {
    console.error('Error loading .env file:', result.error);
    process.exit(1);
}

// Verify required environment variables
const requiredEnvVars = [
    'BASE_URL',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER'
];

for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`Missing required environment variable: ${envVar}`);
        process.exit(1);
    }
}

const express = require('express');
const twilio = require('twilio');
const RoomService = require('./roomService');

const app = express();
app.use(express.json());
app.use(express.static('client'));
app.use(express.urlencoded({ extended: true }));

const roomService = new RoomService({
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
    twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER,
    baseUrl: process.env.BASE_URL,
    livekitApiKey: process.env.LIVEKIT_API_KEY,
    livekitApiSecret: process.env.LIVEKIT_API_SECRET
});

app.post('/join-room', async (req, res) => {
    try {
        const { roomName, participantName } = req.body;
        const token = await roomService.generateLiveKitToken(participantName, roomName);
        res.json({ token });
    } catch (error) {
        console.error('Token generation error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/dial-out', async (req, res) => {
    try {
        const { phoneNumber, roomName } = req.body;
        const result = await roomService.dialOutToPhone(phoneNumber, roomName);
        res.json(result);
    } catch (error) {
        console.error('Dial-out error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/voice/connect-to-room', (req, res) => {
    const twiml = new twilio.twiml.VoiceResponse();
    const roomName = req.query.roomName;

    console.log('Connecting to room:', roomName);
    twiml.say('Connecting you to the conference.');
    
    try {
        twiml.dial().sip(`sip:${roomName}@${process.env.LIVEKIT_DOMAIN}`, {
            username: 'livekit-user',
            password: 'MySecurePass123',
            sipAuthUsername: 'livekit-user'
        });        

        console.log('Generated TwiML:', twiml.toString());
        res.type('text/xml');
        res.send(twiml.toString());
    } catch (error) {
        console.error('Error in connect-to-room:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/voice/status-callback', (req, res) => {
    console.log('Call status update:', req.body);
    res.sendStatus(200);
});

app.post('/voice/conference-status', (req, res) => {
    console.log('Conference status update:', req.body);
    res.sendStatus(200);
});

// Log environment variables at startup
console.log('Environment variables:', {
    BASE_URL: process.env.BASE_URL,
    TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
    // Don't log sensitive credentials
});

// Use PORT from environment variables
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
