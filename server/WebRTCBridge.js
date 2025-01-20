// server/WebRTCBridge.js
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
const { WebSocket } = require('ws');

class AudioProcessor {
    constructor() {
        this.sampleRate = 8000;  // Twilio's mulaw sample rate
        this.channels = 1;
    }

    // Convert base64 mulaw to PCM
    async convertMulawToPCM(base64Audio) {
        const buffer = Buffer.from(base64Audio, 'base64');
        const pcmData = new Int16Array(buffer.length);
        
        // Mulaw to PCM conversion
        for (let i = 0; i < buffer.length; i++) {
            pcmData[i] = this.mulawToPCM(buffer[i]);
        }
        
        return pcmData;
    }

    // Standard mulaw to PCM conversion table
    mulawToPCM(mulawByte) {
        const MULAW_BIAS = 0x84;
        const MULAW_CLIP = 32635;
        
        mulawByte = ~mulawByte;
        let sign = (mulawByte & 0x80) ? -1 : 1;
        let exponent = ((mulawByte & 0x70) >> 4);
        let mantissa = mulawByte & 0x0F;
        
        let magnitude = ((mantissa << 3) + MULAW_BIAS) << exponent;
        return sign * (magnitude - MULAW_BIAS);
    }
}

class WebRTCBridge {
    constructor(config) {
        if (!config.livekitHost || !config.apiKey || !config.apiSecret) {
            throw new Error('Missing required LiveKit configuration');
        }

        this.baseUrl = `https://${config.livekitHost.replace('wss://', '')}`;
        this.wsUrl = config.livekitHost;
        this.apiKey = config.apiKey;
        this.apiSecret = config.apiSecret;
        this.activeStreams = new Map();
        this.roomService = new RoomServiceClient(
            this.baseUrl,
            this.apiKey,
            this.apiSecret
        );
        this.audioProcessor = new AudioProcessor();
    }

    async connectWebSocket(roomName, token) {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`${this.wsUrl}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'User-Agent': 'livekit-twilio-bridge'
                }
            });

            ws.on('open', () => {
                console.log('WebSocket connected to LiveKit');
                resolve(ws);
            });

            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                reject(error);
            });

            ws.on('close', () => {
                console.log('WebSocket closed');
            });
        });
    }

    async createStreamToRoom(conferenceId, roomName) {
        console.log(`Initializing stream for conference ${conferenceId} to room ${roomName}`);
        
        try {
            // List rooms to verify connection
            const rooms = await this.roomService.listRooms();
            console.log('Successfully connected to LiveKit. Available rooms:', rooms);

            // Create room
            try {
                await this.roomService.createRoom({
                    name: roomName,
                    empty_timeout: 300,
                    max_participants: 20
                });
                console.log(`Room ${roomName} created successfully`);
            } catch (error) {
                if (!error.message.includes('already exists')) {
                    throw error;
                }
                console.log(`Room ${roomName} already exists`);
            }

            // Generate participant token
            const participantIdentity = `twilio-bridge-${conferenceId}`;
            const at = new AccessToken(this.apiKey, this.apiSecret, {
                identity: participantIdentity,
                name: `Twilio Call ${conferenceId}`,
                ttl: 86400 // 24 hours
            });

            at.addGrant({
                roomJoin: true,
                room: roomName,
                canPublish: true,
                canSubscribe: true
            });

            const token = at.toJwt();
            console.log(`Generated participant token for ${conferenceId} (identity: ${participantIdentity})`);

            // Connect WebSocket
            const ws = await this.connectWebSocket(roomName, token);

            // Store stream info
            this.activeStreams.set(conferenceId, {
                roomName,
                token,
                status: 'connected',
                participantIdentity,
                ws,
                audioBuffer: [],
                createdAt: Date.now()
            });

            console.log(`Successfully initialized stream for ${conferenceId}`);
            return { token, roomName };

        } catch (error) {
            console.error(`Failed to create stream:`, error);
            this.activeStreams.delete(conferenceId);
            throw error;
        }
    }

    async handleAudioData(conferenceId, audioData, track) {
        const streamInfo = this.activeStreams.get(conferenceId);
        if (!streamInfo) {
            console.warn(`No active stream found for conference ${conferenceId}`);
            return;
        }

        console.log(`Received ${track} audio for conference ${conferenceId} (${streamInfo.status})`);
        console.log(`Participant identity: ${streamInfo.participantIdentity}`);

        try {
            // Convert audio data
            const pcmData = await this.audioProcessor.convertMulawToPCM(audioData);
            
            // Send to LiveKit via WebSocket
            if (streamInfo.ws && streamInfo.ws.readyState === WebSocket.OPEN) {
                streamInfo.ws.send(JSON.stringify({
                    type: 'audio',
                    data: Buffer.from(pcmData.buffer).toString('base64'),
                    sampleRate: 8000,
                    channelCount: 1,
                    trackId: track === 'inbound' ? 'mic' : 'speaker'
                }));
            }

            return true;
        } catch (error) {
            console.error('Error processing audio:', error);
            return false;
        }
    }

    async stopStream(conferenceId) {
        const streamInfo = this.activeStreams.get(conferenceId);
        if (streamInfo) {
            try {
                if (streamInfo.ws) {
                    streamInfo.ws.close();
                }
                await this.roomService.deleteRoom(streamInfo.roomName);
                console.log(`Room ${streamInfo.roomName} deleted`);
            } catch (error) {
                console.warn(`Error deleting room: ${error.message}`);
            }

            this.activeStreams.delete(conferenceId);
            console.log(`Stream stopped for conference ${conferenceId}`);
        }
    }
}

module.exports = WebRTCBridge;