// server/AudioBridge.js
const { RoomServiceClient, AccessToken } = require('livekit-server-sdk');
const WebSocket = require('ws');

class AudioBridge {
    constructor(config) {
        this.roomService = new RoomServiceClient(
            config.livekitHost,
            config.apiKey,
            config.apiSecret
        );
        this.apiKey = config.apiKey;
        this.apiSecret = config.apiSecret;
        this.livekitHost = config.livekitHost;
        this.activeStreams = new Map();
    }

    async createStreamToRoom(conferenceId, roomName) {
        try {
            console.log(`Creating audio bridge for conference ${conferenceId} to room ${roomName}`);
            
            // Create participant identity
            const participantIdentity = `twilio-bridge-${conferenceId}`;

            // Make sure room exists
            try {
                await this.roomService.createRoom({
                    name: roomName,
                    emptyTimeout: 10 * 60, // 10 minutes
                    maxParticipants: 20
                });
                console.log(`Created or confirmed room ${roomName}`);
            } catch (error) {
                // Room may already exist, which is fine
                console.log(`Room may already exist: ${error.message}`);
            }
            
            // Create access token
            const at = new AccessToken(
                this.apiKey,
                this.apiSecret,
                { identity: participantIdentity }
            );

            at.addGrant({
                room: roomName,
                roomJoin: true,
                canPublish: true,
                canSubscribe: true
            });

            const token = await at.toJwt();
            console.log(`Created token for ${participantIdentity}`);

            // Format WebSocket URL correctly
            const wsUrl = `${this.livekitHost.replace('wss://', '')}/signaling`;
            console.log(`Connecting to WebSocket at: wss://${wsUrl}`);

            // Set up WebSocket connection
            const ws = new WebSocket(`wss://${wsUrl}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            // Set up WebSocket event handlers
            const wsPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('WebSocket connection timeout'));
                }, 5000);

                ws.on('open', () => {
                    clearTimeout(timeout);
                    console.log(`WebSocket opened for ${participantIdentity}`);
                    
                    // Send join message
                    const joinMessage = {
                        type: 'join',
                        token: token,
                        metadata: JSON.stringify({
                            type: 'twilio-bridge',
                            conferenceId: conferenceId
                        })
                    };
                    ws.send(JSON.stringify(joinMessage));
                    resolve(ws);
                });

                ws.on('error', (error) => {
                    clearTimeout(timeout);
                    console.error(`WebSocket error for ${participantIdentity}:`, error);
                    reject(error);
                });

                ws.on('message', (data) => {
                    try {
                        const msg = JSON.parse(data);
                        console.log(`Received message from LiveKit server:`, msg.type);
                        if (msg.type === 'join_response') {
                            console.log('Successfully joined LiveKit room');
                        }
                    } catch (err) {
                        console.error('Error parsing LiveKit message:', err);
                    }
                });
            });

            // Wait for WebSocket connection
            await wsPromise;

            // Store stream info
            this.activeStreams.set(conferenceId, {
                roomName,
                participantIdentity,
                status: 'connected',
                ws,
                token
            });

            console.log(`Successfully created audio bridge for ${participantIdentity}`);

            return {
                token,
                participantIdentity
            };

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
            if (!streamInfo.ws || streamInfo.ws.readyState !== WebSocket.OPEN) {
                console.warn(`WebSocket not ready for ${conferenceId}, state:`, 
                    streamInfo.ws ? streamInfo.ws.readyState : 'no websocket');
                return;
            }

            // Format audio message
            const message = {
                type: 'audio',
                data: audioData,
                timestamp: Date.now(),
                metadata: JSON.stringify({
                    encoding: 'mulaw',
                    sampleRate: 8000,
                    channels: 1
                })
            };

            streamInfo.ws.send(JSON.stringify(message));
            
            if (streamInfo.status === 'connecting') {
                console.log('First audio packet sent successfully');
                streamInfo.status = 'connected';
            }

        } catch (error) {
            console.error(`Error handling audio data for ${conferenceId}:`, error);
        }
    }

    async stopStream(conferenceId) {
        try {
            const streamInfo = this.activeStreams.get(conferenceId);
            if (streamInfo) {
                try {
                    // Send leave message before closing
                    if (streamInfo.ws && streamInfo.ws.readyState === WebSocket.OPEN) {
                        streamInfo.ws.send(JSON.stringify({
                            type: 'leave',
                            room: streamInfo.roomName
                        }));
                        streamInfo.ws.close();
                    }
                } catch (err) {
                    console.error('Error closing WebSocket:', err);
                }
                this.activeStreams.delete(conferenceId);
                console.log(`Stream stopped for conference ${conferenceId}`);
            }
        } catch (error) {
            console.error('Error stopping stream:', error);
        }
    }
}

module.exports = AudioBridge;