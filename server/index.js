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
const WebRTCBridge = require('./WebRTCBridge');
const WebSocket = require('ws');

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

const audioBridge = new WebRTCBridge({
    livekitHost: process.env.LIVEKIT_HOST,
    apiKey: process.env.LIVEKIT_API_KEY,
    apiSecret: process.env.LIVEKIT_API_SECRET
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
app.post('/voice/connect-to-room', (req, res) => {
    const twiml = new twilio.twiml.VoiceResponse();
    const roomName = req.query.roomName;
    const conferenceRoomName = `livekit-bridge-${roomName}`;

    console.log('Setting up conference:', {
        roomName,
        conferenceRoomName,
        callbackUrl: `${process.env.BASE_URL}/voice/conference-status`,
        streamUrl: `${process.env.BASE_URL}/conference-stream`
    });
    
    twiml.say('Connecting you to the conference.');
    
    // Set up stream before conference
    twiml.start().stream({
        name: conferenceRoomName,
        url: `wss://${process.env.BASE_URL.replace('https://', '')}/conference-stream`,
        track: 'both'
    });
    
    const dial = twiml.dial();
    dial.conference(conferenceRoomName, {
        statusCallback: `${process.env.BASE_URL}/voice/conference-status`,
        statusCallbackEvent: ['join', 'leave', 'start', 'end', 'speak'],
        statusCallbackMethod: 'POST',
        startConferenceOnEnter: true,
        endConferenceOnExit: false,
        beep: false,
        waitUrl: null  // Disable hold music since we're handling the audio stream
    });

    console.log('Generated Conference TwiML:', twiml.toString());
    res.type('text/xml');
    res.send(twiml.toString());
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

app.post('/voice/conference-status', async (req, res) => {
    console.log('\n--- Conference Status Update ---');
    console.log('Event Type:', req.body.StatusCallbackEvent);
    console.log('Conference SID:', req.body.ConferenceSid);
    console.log('Conference Name:', req.body.FriendlyName);
    console.log('Participant SID:', req.body.ParticipantSid);
    console.log('Full Event Data:', req.body);
    
    res.sendStatus(200);
});

// Set up HTTP server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
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

// WebSocket server setup
const wss = new WebSocket.Server({ server });
console.log('WebSocket server initialized');

// Handle WebSocket connections
// WebSocket connection handling in index.js
wss.on('connection', async (ws, req) => {
    console.log('New WebSocket connection established for conference stream');
    let streamSid = null;
    let conferenceId = null;

    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data.toString());
            console.log('Received WebSocket message:', message);
            
            switch (message.event) {
                case 'connected':
                    console.log('WebSocket connection established');
                    break;

                case 'start':
                    streamSid = message.streamSid;
                    conferenceId = message.start.callSid;
                    console.log('Stream started:', {
                        streamSid,
                        conferenceId,
                        mediaFormat: message.start.mediaFormat
                    });
                    
                    try {
                        // Create audio bridge when stream starts
                        await audioBridge.createStreamToRoom(conferenceId, 'support-room');
                        console.log(`Created audio bridge for conference ${conferenceId}`);
                        
                        // Optionally list active streams for debugging
                        audioBridge.listActiveStreams();
                    } catch (error) {
                        console.error('Error creating audio bridge:', error);
                    }
                    break;

                case 'media':
                    if (conferenceId) {
                        try {
                            await audioBridge.handleAudioData(conferenceId, message.media.payload);
                        } catch (error) {
                            console.error(`Error handling media for ${conferenceId}:`, error);
                        }
                    } else {
                        console.warn('Received media before stream start');
                    }
                    break;

                case 'stop':
                    if (conferenceId) {
                        console.log('Stream stopping:', {
                            streamSid,
                            conferenceId
                        });
                        await audioBridge.stopStream(conferenceId);
                    }
                    break;
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
        }
    });

    ws.on('close', async () => {
        if (conferenceId) {
            console.log('WebSocket connection closing:', {
                streamSid,
                conferenceId
            });
            await audioBridge.stopStream(conferenceId);
        }
    });

    // Send a connection acknowledgment
    ws.send(JSON.stringify({ 
        event: 'acknowledge', 
        message: 'WebSocket connection established' 
    }));
});