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
    'TWILIO_PHONE_NUMBER',
    'LIVEKIT_API_KEY',
    'LIVEKIT_API_SECRET',
    'LIVEKIT_HOST'
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

// Initialize services
const roomService = new RoomService({
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
    twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER,
    baseUrl: process.env.BASE_URL,
    livekitApiKey: process.env.LIVEKIT_API_KEY,
    livekitApiSecret: process.env.LIVEKIT_API_SECRET
});


// LiveKit room endpoints
app.post('/join-room', async (req, res) => {
    console.log('Join room request:', req.body);
    try {
        const { roomName, participantName } = req.body;
        const token = await roomService.generateLiveKitToken(participantName, roomName);
        res.json({ token });
    } catch (error) {
        console.error('Token generation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Twilio dial-out endpoint
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

// Twilio voice endpoints
// In index.js

app.post('/voice/connect-to-room', (req, res) => {
    const twiml = new twilio.twiml.VoiceResponse();
    const roomName = req.query.roomName;

    console.log('Connecting to room:', roomName);

    twiml.pause({ length: 2 });
    twiml.say('Connecting you to the conference.');

    // Set up stream before conference
    twiml.start().stream({
        name: conferenceRoomName,
        url: `wss://${process.env.BASE_URL.replace('https://', '')}/conference-stream`,
        track: 'both'
    });

    try {
        twiml.dial().sip({
            username: 'livekit-user',
            password: 'MySecurePass123'
        }, `sip:${roomName}@${process.env.LIVEKIT_DOMAIN};transport=tcp`);

        console.log('Generated TwiML:', twiml.toString());
        res.type('text/xml');
        res.send(twiml.toString());
    } catch (error) {
        console.error('Error in connect-to-room:', error);
        res.status(500).json({ error: error.message });
    }
});

// Twilio status callbacks
app.post('/voice/recording-status', (req, res) => {
    console.log('Recording status update:', req.body);
    res.sendStatus(200);
});

app.post('/voice/status-callback', (req, res) => {
    const callStatus = req.body;
    console.log('Call status update:', callStatus);

    if (callStatus.CallStatus === 'completed') {
        roomService.handleCallCompletion(callStatus.CallSid);
    }

    res.sendStatus(200);
});
// Set up HTTP server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('Environment variables:', {
        BASE_URL: process.env.BASE_URL,
        TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID ? 'Set' : 'Missing',
        TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ? 'Set' : 'Missing',
        TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
        LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY ? 'Set' : 'Missing',
        LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET ? 'Set' : 'Missing',
        LIVEKIT_HOST: process.env.LIVEKIT_HOST
    });
});

