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

// Updated to use Conference instead of SIP
app.post('/voice/connect-to-room', (req, res) => {
    const twiml = new twilio.twiml.VoiceResponse();
    const roomName = req.query.roomName;
    const conferenceRoomName = `livekit-bridge-${roomName}`;

    console.log('Connecting to conference room:', conferenceRoomName);
    
    twiml.say('Connecting you to the conference.');
    
    const dial = twiml.dial();
    dial.conference(conferenceRoomName, {
        startConferenceOnEnter: true,
        endConferenceOnExit: false,
        record: false, // Changed to false unless you need recording
        statusCallback: `${process.env.BASE_URL}/voice/conference-status`,
        statusCallbackEvent: ['join', 'leave', 'start', 'end'],
        waitUrl: 'http://twimlets.com/holdmusic?Bucket=com.twilio.music.classical',
        beep: false, // Disable join/leave beeps
        trim: 'trim-silence' // Remove silence
    });

    console.log('Generated Conference TwiML:', twiml.toString());
    res.type('text/xml');
    res.send(twiml.toString());
});
// Enhanced status callback handler
app.post('/voice/status-callback', (req, res) => {
    const callStatus = req.body;
    console.log('Call status update:', callStatus);
    
    // Notify LiveKit room of status changes if needed
    if (callStatus.CallStatus === 'completed') {
        // Handle call completion
        roomService.handleCallCompletion(callStatus.CallSid);
    }
    
    res.sendStatus(200);
});

// New conference status handler
app.post('/voice/conference-status', async (req, res) => {
    const conferenceStatus = req.body;
    console.log('Conference status update:', conferenceStatus);
    
    try {
        // Handle conference events
        await roomService.handleConferenceEvent(conferenceStatus);
        res.sendStatus(200);
    } catch (error) {
        console.error('Error handling conference status:', error);
        res.sendStatus(500);
    }
});

// Log environment variables at startup (excluding sensitive data)
console.log('Environment variables:', {
    BASE_URL: process.env.BASE_URL,
    TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});