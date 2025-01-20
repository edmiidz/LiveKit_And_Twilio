// server/WebRTCBridge.js
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');
const WebSocket = require('ws');
const crypto = require('crypto');

class WebRTCBridge {
    constructor(config) {
        if (!config.livekitHost || !config.apiKey || !config.apiSecret) {
            throw new Error('Missing required LiveKit configuration');
        }

        // Store full URLs properly
        this.baseUrl = config.livekitHost.replace('wss://', 'https://');
        this.wsUrl = config.livekitHost;
        this.apiKey = config.apiKey;
        this.apiSecret = config.apiSecret;
        this.activeStreams = new Map();
        
        // Initialize RoomService with proper API key and secret
        this.roomService = new RoomServiceClient(
            this.baseUrl,
            this.apiKey,
            this.apiSecret
        );

        console.log('LiveKit configuration:', {
            baseUrl: this.baseUrl,
            wsUrl: this.wsUrl
        });
    }

    generateAuthHeader(method, path, body = '') {
        const timestamp = Math.floor(Date.now() / 1000);
        const nonce = crypto.randomBytes(16).toString('hex');
        
        const payload = [
            timestamp.toString(),
            method,
            path,
            nonce,
            body
        ].join(' ');

        const hmac = crypto.createHmac('sha256', this.apiSecret);
        hmac.update(payload);
        const hash = hmac.digest('base64');

        return `Bearer ${this.apiKey} ${timestamp} ${nonce} ${hash}`;
    }

    async createStreamToRoom(conferenceId, roomName) {
        console.log(`Initializing stream for conference ${conferenceId} to room ${roomName}`);
        
        try {
            // Create the room
            try {
                const createResponse = await fetch(`${this.baseUrl}/twirp/livekit.RoomService/CreateRoom`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': this.generateAuthHeader('POST', '/twirp/livekit.RoomService/CreateRoom')
                    },
                    body: JSON.stringify({
                        name: roomName,
                        empty_timeout: 300,
                        max_participants: 20
                    })
                });

                console.log('Create room response:', await createResponse.text());

                if (!createResponse.ok && !createResponse.status === 409) { // 409 = already exists
                    throw new Error(`Failed to create room: ${createResponse.statusText}`);
                }
            } catch (error) {
                if (!error.message.includes('already exists')) {
                    throw error;
                }
            }

            // Create access token
            const at = new AccessToken(this.apiKey, this.apiSecret, {
                identity: `twilio-bridge-${conferenceId}`,
                name: `Twilio Bridge ${conferenceId}`,
            });

            at.addGrant({
                roomJoin: true,
                room: roomName,
                canPublish: true,
                canSubscribe: true,
                canPublishData: true
            });

            const token = at.toJwt();
            console.log('Generated token:', {
                identity: `twilio-bridge-${conferenceId}`,
                roomName: roomName
            });

            // Join the room first
            const joinResponse = await fetch(`${this.baseUrl}/twirp/livekit.RoomService/JoinRoom`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': this.generateAuthHeader('POST', '/twirp/livekit.RoomService/JoinRoom')
                },
                body: JSON.stringify({
                    room: roomName,
                    participant: {
                        identity: `twilio-bridge-${conferenceId}`,
                        metadata: JSON.stringify({ type: 'twilio-bridge' })
                    }
                })
            });

            const joinData = await joinResponse.text();
            console.log('Join room response:', {
                status: joinResponse.status,
                data: joinData
            });

            if (!joinResponse.ok) {
                throw new Error(`Failed to join room: ${joinData}`);
            }

            // Connect WebSocket
            const ws = new WebSocket(`${this.wsUrl}/rtc/${roomName}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            await new Promise((resolve, reject) => {
                ws.on('open', resolve);
                ws.on('error', reject);
            });

            // Store connection
            this.activeStreams.set(conferenceId, {
                roomName,
                token,
                status: 'connected',
                ws,
                createdAt: Date.now()
            });

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

        if (streamInfo.status === 'connected' && streamInfo.ws?.readyState === WebSocket.OPEN) {
            try {
                streamInfo.ws.send(JSON.stringify({
                    type: 'media',
                    data: audioData,
                    source: track === 'inbound' ? 'microphone' : 'speaker',
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
                const deleteResponse = await fetch(`${this.baseUrl}/twirp/livekit.RoomService/DeleteRoom`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': this.generateAuthHeader('POST', '/twirp/livekit.RoomService/DeleteRoom')
                    },
                    body: JSON.stringify({
                        room: streamInfo.roomName
                    })
                });
                
                console.log('Delete room response:', await deleteResponse.text());
            } catch (error) {
                console.warn('Error cleaning up stream:', error);
            }

            this.activeStreams.delete(conferenceId);
        }
    }
}

module.exports = WebRTCBridge;