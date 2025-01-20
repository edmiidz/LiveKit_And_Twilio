// server/WebRTCBridge.js
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
const WebSocket = require('ws');
const fetch = require('node-fetch');

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

    async restJoinRoom(token, roomName) {
        // First join via REST API
        const joinUrl = `${this.baseUrl}/twirp/livekit.RoomService/JoinRoom`;
        console.log('Joining room via REST:', joinUrl);
        
        const response = await fetch(joinUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                room: roomName,
                participant: {
                    metadata: JSON.stringify({ source: 'twilio-bridge' })
                }
            })
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Failed to join room: ${text}`);
        }

        const joinResponse = await response.json();
        console.log('Join response:', joinResponse);
        
        // Now connect WebSocket with join response
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`${this.wsUrl}/rtc/${roomName}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Connection-Id': joinResponse.connectionId || ''
                }
            });

            ws.on('open', () => {
                console.log('WebSocket connected');
                resolve(ws);
            });

            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                reject(error);
            });

            ws.on('close', (code, reason) => {
                console.log(`WebSocket closed: ${code} - ${reason}`);
            });

            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    console.log('Received LiveKit message:', msg);
                } catch (error) {
                    console.warn('Error parsing WebSocket message:', error);
                }
            });
        });
    }

    async createStreamToRoom(conferenceId, roomName) {
        console.log(`Initializing stream for conference ${conferenceId} to room ${roomName}`);
        
        try {
            // Create room if needed
            try {
                await this.roomService.createRoom({
                    name: roomName,
                    emptyTimeout: 300,
                    maxParticipants: 20
                });
                console.log(`Room ${roomName} created successfully`);
            } catch (error) {
                if (!error.message.includes('already exists')) {
                    throw error;
                }
                console.log(`Room ${roomName} already exists`);
            }

            // Create participant token
            const at = new AccessToken(this.apiKey, this.apiSecret, {
                identity: `twilio-bridge-${conferenceId}`,
                ttl: 86400
            });

            at.addGrant({
                roomJoin: true,
                room: roomName,
                canPublish: true,
                canSubscribe: true
            });

            const token = at.toJwt();
            console.log(`Generated participant token for ${conferenceId}`);

            // Join room and establish WebSocket
            const ws = await this.restJoinRoom(token, roomName);

            // Store stream info
            this.activeStreams.set(conferenceId, {
                roomName,
                token,
                status: 'connected',
                ws,
                createdAt: Date.now()
            });

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

        if (streamInfo.status === 'connected' && streamInfo.ws?.readyState === WebSocket.OPEN) {
            try {
                streamInfo.ws.send(JSON.stringify({
                    type: 'audio',
                    source: track === 'inbound' ? 'microphone' : 'speaker',
                    payload: audioData,
                    encoding: 'mulaw',
                    sampleRate: 8000,
                    channels: 1
                }));
                return true;
            } catch (error) {
                console.error('Error sending audio:', error);
                return false;
            }
        }
        return false;
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
                console.warn('Error cleaning up stream:', error);
            }

            this.activeStreams.delete(conferenceId);
            console.log(`Stream stopped for conference ${conferenceId}`);
        }
    }
}

module.exports = WebRTCBridge;