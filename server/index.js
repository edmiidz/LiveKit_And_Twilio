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

// ... (previous imports)
const AudioBridge = require('./AudioBridge');
const WebSocket = require('ws');

// Initialize AudioBridge
const audioBridge = new AudioBridge({
    livekitHost: process.env.LIVEKIT_HOST,
    apiKey: process.env.LIVEKIT_API_KEY,
    apiSecret: process.env.LIVEKIT_API_SECRET
});



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

app.post('/voice/connect-to-room', (req, res) => {
    const twiml = new twilio.twiml.VoiceResponse();
    const roomName = req.query.roomName;
    const conferenceRoomName = `livekit-bridge-${roomName}`;

    console.log('Connecting to conference room:', conferenceRoomName);
    
    twiml.say('Connecting you to the conference.');
    
    const dial = twiml.dial();
    dial.conference(conferenceRoomName, {
        statusCallbackEvent: ['join', 'leave', 'start', 'end', 'speak'],
        statusCallback: `${process.env.BASE_URL}/voice/conference-status`,
        statusCallbackMethod: 'POST',
        startConferenceOnEnter: true,
        endConferenceOnExit: false,
        record: true,  // Enable recording
        mediaCapabilities: {
            audio: {
                mediaType: 'mpeg',
                codec: 'mp3'
            }
        }
    });

    console.log('Generated Conference TwiML:', twiml.toString());
    res.type('text/xml');
    res.send(twiml.toString());
});

app.post('/voice/conference-status', async (req, res) => {
    console.log('\n--- Conference Status Update ---');
    console.log('Event Type:', req.body.StatusCallbackEvent);
    console.log('Conference SID:', req.body.ConferenceSid);
    console.log('Conference Name:', req.body.ConferenceName);
    console.log('Conference Status:', req.body.ConferenceStatus);
    console.log('Participant SID:', req.body.ParticipantSid);
    
    if (req.body.StatusCallbackEvent === 'participant-join') {
        try {
            // Create a Media Stream when participant joins
            const streamResponse = await roomService.twilioClient.conferences(req.body.ConferenceSid)
                .update({
                    mediaUrl: `wss://${process.env.BASE_URL}/conference-stream`
                });
            
            console.log('Created media stream:', streamResponse);
        } catch (error) {
            console.error('Error creating media stream:', error);
        }
    }

    try {
        await roomService.handleConferenceEvent(req.body);
        res.sendStatus(200);
    } catch (error) {
        console.error('Error handling conference status:', error);
        res.sendStatus(500);
    }
});

// Add WebSocket handler for conference stream
const wss = new WebSocket.Server({ noServer: true });

app.on('upgrade', (request, socket, head) => {
    if (request.url === '/conference-stream') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    }
});

// Handle WebSocket connections
wss.on('connection', (ws) => {
    console.log('New WebSocket connection for conference stream');
    
    ws.on('message', async (data) => {
        try {
            // Process the media stream and forward to LiveKit
            const audioData = JSON.parse(data);
            // Here we'll need to implement the actual audio forwarding to LiveKit
            console.log('Received audio data from conference');
        } catch (error) {
            console.error('Error processing media stream:', error);
        }
    });
});



// Handle WebSocket connections
wss.on('connection', async (ws, req) => {
    console.log('New WebSocket connection for conference stream');
    let conferenceId = null;

    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data);
            
            // Handle different types of messages from Twilio Media Streams
            switch (message.event) {
                case 'start':
                    conferenceId = message.start.conferenceId;
                    console.log('Starting media stream for conference:', conferenceId);
                    // Create the bridge to LiveKit
                    await audioBridge.createStreamToRoom(conferenceId, 'support-room');
                    break;

                case 'media':
                    if (conferenceId) {
                        await audioBridge.handleAudioData(conferenceId, message.media.payload);
                    }
                    break;

                case 'stop':
                    if (conferenceId) {
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
            await audioBridge.stopStream(conferenceId);
        }
    });
});

// Update conference status handler to include media streaming
app.post('/voice/conference-status', async (req, res) => {
    console.log('\n--- Conference Status Update ---');
    console.log('Event Type:', req.body.StatusCallbackEvent);
    console.log('Conference SID:', req.body.ConferenceSid);
    
    if (req.body.StatusCallbackEvent === 'participant-join') {
        try {
            // Set up media stream when participant joins
            const streamConnector = await roomService.twilioClient.conferences(req.body.ConferenceSid)
                .update({
                    mediaUrl: `wss://${process.env.BASE_URL}/conference-stream`
                });
            console.log('Created media stream connector:', streamConnector.sid);
        } catch (error) {
            console.error('Error setting up media stream:', error);
        }
    }

    res.sendStatus(200);
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