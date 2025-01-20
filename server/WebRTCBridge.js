// server/WebRTCBridge.js
const { RoomServiceClient, AccessToken } = require('livekit-server-sdk');
const WebSocket = require('ws');

class WebRTCBridge {
    constructor(config) {
        this.roomService = new RoomServiceClient(
            config.livekitHost.replace('wss://', 'https://'),
            config.apiKey,
            config.apiSecret
        );
        this.apiKey = config.apiKey;
        this.apiSecret = config.apiSecret;
        this.livekitHost = config.livekitHost;
        this.activeStreams = new Map();
    }

    async createStreamToRoom(conferenceId, roomName) {
        console.log(`Creating audio bridge for conference ${conferenceId} to room ${roomName}`);
        
        try {
            // Create or get the room
            let room = await this.roomService.getRoom(roomName);
            if (!room) {
                room = await this.roomService.createRoom({
                    name: roomName,
                    emptyTimeout: 300
                });
            }

            // Create a participant token
            const at = new AccessToken(this.apiKey, this.apiSecret, {
                identity: `twilio-bridge-${conferenceId}`,
                name: `Twilio Call ${conferenceId}`
            });

            at.addGrant({
                roomJoin: true,
                room: roomName,
                canPublish: true,
                canSubscribe: true
            });

            const token = at.toJwt();

            // Store stream info
            this.activeStreams.set(conferenceId, {
                roomName,
                token,
                audioBuffer: [],
                participants: new Set()
            });

            // Connect to LiveKit room using WebSocket
            const ws = new WebSocket(this.livekitHost, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            ws.on('open', () => {
                console.log(`WebSocket connected for conference ${conferenceId}`);
                // Join room
                ws.send(JSON.stringify({
                    type: 'join',
                    room: roomName,
                    metadata: JSON.stringify({ type: 'twilio-bridge' })
                }));
            });

            ws.on('message', (data) => {
                const msg = JSON.parse(data);
                console.log('LiveKit WebSocket message:', msg);
            });

            // Store WebSocket connection
            this.activeStreams.get(conferenceId).ws = ws;

            return { token, room };
        } catch (error) {
            console.error('Error creating stream to room:', error);
            throw error;
        }
    }

    async handleAudioData(conferenceId, audioData) {
        const streamInfo = this.activeStreams.get(conferenceId);
        if (!streamInfo) {
            console.warn(`No active stream found for conference ${conferenceId}`);
            return;
        }

        try {
            if (streamInfo.ws && streamInfo.ws.readyState === WebSocket.OPEN) {
                // Send audio data to LiveKit
                streamInfo.ws.send(JSON.stringify({
                    type: 'audio',
                    data: audioData,
                    encoding: 'mulaw',
                    sampleRate: 8000,
                    channels: 1
                }));
            } else {
                console.log('WebSocket not ready, buffering audio');
                streamInfo.audioBuffer.push(audioData);
            }
        } catch (error) {
            console.error('Error handling audio data:', error);
        }
    }

    async stopStream(conferenceId) {
        const streamInfo = this.activeStreams.get(conferenceId);
        if (streamInfo) {
            if (streamInfo.ws) {
                streamInfo.ws.close();
            }
            this.activeStreams.delete(conferenceId);
            console.log(`Stream stopped for conference ${conferenceId}`);
        }
    }
}

module.exports = WebRTCBridge;