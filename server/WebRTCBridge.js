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
        
        // Initialize RoomService
        this.roomService = new RoomServiceClient(
            this.baseUrl,
            this.apiKey,
            this.apiSecret
        );
    }

    generateToken(identity, roomName) {
        const at = new AccessToken(this.apiKey, this.apiSecret, {
            identity,
            name: identity,  // Display name
            ttl: 86400  // 24 hours
        });

        at.addGrant({
            roomJoin: true,
            room: roomName,
            canPublish: true,
            canSubscribe: true,
            canPublishData: true
        });

        return at.toJwt();
    }

    async createStreamToRoom(conferenceId, roomName) {
        console.log(`Initializing stream for conference ${conferenceId} to room ${roomName}`);
        const participantIdentity = `twilio-bridge-${conferenceId}`;
        
        try {
            // First generate token for all operations
            const token = this.generateToken(participantIdentity, roomName);
            console.log(`Generated token for ${participantIdentity}`);

            // Create or join room
            try {
                await fetch(`${this.baseUrl}/twirp/livekit.RoomService/CreateRoom`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        name: roomName,
                        empty_timeout: 300,
                        max_participants: 20
                    })
                });
                console.log('Room created or already exists');
            } catch (error) {
                if (!error.message.includes('already exists')) {
                    throw error;
                }
            }

            // Join room
            const joinResponse = await fetch(`${this.baseUrl}/twirp/livekit.RoomService/JoinRoom`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    room: roomName,
                    participant: {
                        identity: participantIdentity,
                        name: participantIdentity,
                        metadata: JSON.stringify({ type: 'twilio-bridge' })
                    }
                })
            });

            if (!joinResponse.ok) {
                const errorText = await joinResponse.text();
                console.error('Join room failed:', {
                    status: joinResponse.status,
                    body: errorText
                });
                throw new Error(`Failed to join room: ${errorText}`);
            }

            const joinData = await joinResponse.json();
            console.log('Successfully joined room:', joinData);

            // Connect WebSocket
            const ws = new WebSocket(`${this.wsUrl}/rtc/connect`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            // Wait for connection
            await new Promise((resolve, reject) => {
                ws.on('open', () => {
                    console.log('WebSocket connected');
                    // Send join message
                    ws.send(JSON.stringify({
                        type: 'join',
                        room: roomName,
                        token: token,
                        metadata: JSON.stringify({ type: 'twilio-bridge' })
                    }));
                    resolve();
                });
                ws.on('error', reject);
            });

            // Store connection
            this.activeStreams.set(conferenceId, {
                roomName,
                token,
                status: 'connected',
                participantIdentity,
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
                    track_id: track === 'inbound' ? 'mic' : 'speaker',
                    data: audioData,
                    encoding: 'mulaw',
                    sample_rate: 8000,
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
                
                await fetch(`${this.baseUrl}/twirp/livekit.RoomService/DeleteRoom`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${streamInfo.token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        room: streamInfo.roomName
                    })
                });
                
                console.log(`Room ${streamInfo.roomName} deleted`);
            } catch (error) {
                console.warn('Error cleaning up stream:', error);
            }

            this.activeStreams.delete(conferenceId);
        }
    }
}

module.exports = WebRTCBridge;