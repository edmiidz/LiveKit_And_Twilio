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

    async joinRoom(token, roomName) {
        return new Promise((resolve, reject) => {
            // Use the LiveKit signaling endpoint
            const wsUrl = `${this.wsUrl}/rtc/connect?access_token=${token}&room=${roomName}`;
            console.log('Connecting to LiveKit at:', wsUrl);
            
            const ws = new WebSocket(wsUrl);

            ws.on('open', () => {
                console.log('WebSocket connection established');
                
                // Send join message following LiveKit protocol
                const joinMessage = {
                    type: 'join',
                    room: roomName,
                    token: token,
                    metadata: JSON.stringify({ source: 'twilio-bridge' }),
                    protocol: 2
                };
                
                ws.send(JSON.stringify(joinMessage));
            });

            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    console.log('Received LiveKit message:', message.type);
                    
                    if (message.type === 'join_response') {
                        console.log('Successfully joined room');
                        resolve(ws);
                    } else if (message.type === 'error') {
                        reject(new Error(`LiveKit error: ${message.error}`));
                    }
                } catch (error) {
                    console.warn('Failed to parse WebSocket message:', error);
                }
            });

            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                reject(error);
            });

            ws.on('close', (code, reason) => {
                console.log(`WebSocket closed: ${code} - ${reason}`);
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
                console.log(`Room ${roomName} created`);
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
            console.log('Generated access token');

            // Join room using LiveKit protocol
            const ws = await this.joinRoom(token, roomName);
            console.log('Successfully joined LiveKit room');

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
                // Send audio following LiveKit protocol
                const audioMessage = {
                    type: 'audio',
                    track_id: track === 'inbound' ? 'mic' : 'speaker',
                    data: audioData,
                    encoding: 'mulaw',
                    sample_rate: 8000,
                    channels: 1,
                    sequence: Date.now()
                };

                streamInfo.ws.send(JSON.stringify(audioMessage));
                return true;
            } catch (error) {
                console.error('Error sending audio data:', error);
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
                    // Send leave message before closing
                    const leaveMessage = {
                        type: 'leave',
                        room: streamInfo.roomName,
                        reason: 'disconnect'
                    };
                    streamInfo.ws.send(JSON.stringify(leaveMessage));
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