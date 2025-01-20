// server/WebRTCBridge.js
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
const WebSocket = require('ws');

class WebRTCBridge {
    constructor(config) {
        if (!config.livekitHost || !config.apiKey || !config.apiSecret) {
            throw new Error('Missing required LiveKit configuration');
        }

        this.baseUrl = config.livekitHost.replace('wss://', 'https://');
        this.wsUrl = config.livekitHost;
        this.apiKey = config.apiKey;
        this.apiSecret = config.apiSecret;
        this.activeStreams = new Map();
        
        this.roomService = new RoomServiceClient(
            this.baseUrl,
            this.apiKey,
            this.apiSecret
        );
    }

    async connectToLiveKitRoom(token) {
        return new Promise((resolve, reject) => {
            console.log('Connecting to LiveKit WebSocket...');
            
            // Create WebSocket connection with token
            const ws = new WebSocket(this.wsUrl, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                rejectUnauthorized: false // For testing only
            });

            ws.on('open', () => {
                console.log('WebSocket connected, sending join message...');
                resolve(ws);
            });

            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                reject(error);
            });
        });
    }

    async createStreamToRoom(conferenceId, roomName) {
        console.log(`Initializing stream for conference ${conferenceId} to room ${roomName}`);
        
        try {
            // First create/get the room
            try {
                await this.roomService.createRoom({
                    name: roomName,
                    emptyTimeout: 300,
                });
                console.log(`Room ${roomName} created successfully`);
            } catch (error) {
                if (!error.message.includes('already exists')) {
                    throw error;
                }
                console.log(`Room ${roomName} already exists`);
            }

            // Create access token
            const at = new AccessToken(
                this.apiKey,
                this.apiSecret,
                {
                    identity: `twilio-bridge-${conferenceId}`,
                }
            );

            at.addGrant({
                roomJoin: true,
                room: roomName,
                canPublish: true,
                canSubscribe: true
            });

            const token = at.toJwt();
            console.log(`Generated participant token for ${conferenceId}`);

            // Connect to room via WebSocket
            const ws = await this.connectToLiveKitRoom(token);
            console.log('Connected to LiveKit room');

            // Store connection info
            this.activeStreams.set(conferenceId, {
                roomName,
                token,
                status: 'connected',
                ws,
                createdAt: Date.now()
            });

            // Set up message handler
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data);
                    console.log('Received LiveKit message:', msg.type || 'unknown type');
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            });

            console.log('Successfully initialized stream for', conferenceId);
            return { token, roomName };

        } catch (error) {
            console.error('Failed to create stream:', error);
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

        if (streamInfo.ws && streamInfo.ws.readyState === WebSocket.OPEN) {
            try {
                // Send audio data to LiveKit
                streamInfo.ws.send(JSON.stringify({
                    type: 'audio_data',
                    track_type: track,
                    data: audioData,
                    timestamp: Date.now()
                }));
                return true;
            } catch (error) {
                console.error('Error sending audio data:', error);
                return false;
            }
        } else {
            console.log('WebSocket not ready');
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
                console.warn(`Error cleaning up stream:`, error);
            }

            this.activeStreams.delete(conferenceId);
            console.log(`Stream stopped for conference ${conferenceId}`);
        }
    }
}

module.exports = WebRTCBridge;