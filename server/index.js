const dotenv = require('dotenv');
const express = require('express');
const RoomService = require('./roomService');
const twilio = require('twilio');

// Load environment variables
const result = dotenv.config();
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

// Initialize Express app
const app = express();
app.use(express.json());
app.use(express.static('client'));
app.use(express.urlencoded({ extended: true }));

// Initialize RoomService
const roomService = new RoomService({
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
    twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER,
    baseUrl: process.env.BASE_URL,
    livekitApiKey: process.env.LIVEKIT_API_KEY,
    livekitApiSecret: process.env.LIVEKIT_API_SECRET,
    livekitWsUrl: process.env.LIVEKIT_HOST,
});

// Route handlers
app.post('/join-room', async (req, res) => {
    const { roomName, participantName } = req.body;
    try {
        console.log(`Join room request received for room: ${roomName}, participant: ${participantName}`);
        const token = roomService.generateLiveKitToken(participantName, roomName);
        res.json({ token });
    } catch (error) {
        console.error('Error generating LiveKit token:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/dial-out', async (req, res) => {
    const { phoneNumber, roomName } = req.body;
    try {
        console.log(`Dial-out request: Phone=${phoneNumber}, Room=${roomName}`);
        const result = await roomService.dialOutToPhone(phoneNumber, roomName);
        res.json(result);
    } catch (error) {
        console.error('Error in dial-out:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/voice/recording-status', (req, res) => {
    console.log('Recording status update:', req.body);
    res.sendStatus(200);
});

app.post('/voice/status-callback', (req, res) => {
    console.log('Voice status callback received:', req.body);
    const { CallStatus, CallSid } = req.body;
    if (CallStatus === 'completed') {
        console.log(`Call completed. CallSid: ${CallSid}`);
    }
    res.sendStatus(200);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
