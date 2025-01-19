// server/WebRTCBridge.js
const { RoomServiceClient, AccessToken } = require('livekit-server-sdk');
const { Room } = require('livekit-client');
const WebSocket = require('ws');

class WebRTCBridge {
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

        // Buffer for audio packets while connection is establishing
        this.pendingAudio = new Map();
    }

    async setupRoom(roomName) {
        try {
            const rooms = await this.roomService.listRooms();
            const room = rooms.find(r => r.name === roomName);
            if (!room) {
                await this.roomService.createRoom({
                    name: roomName,
                    emptyTimeout: 300,
                });
                console.log('Created new LiveKit room:', roomName);
            }
        } catch (error) {
            console.error('Error setting up room:', error);
            throw error;
        }
    }

    async createStreamToRoom(conferenceId, roomName) {
        try {
            console.log(`Creating audio bridge for conference ${conferenceId} to room ${roomName}`);
            
            // Initialize audio buffer
            this.pendingAudio.set(conferenceId, []);
            
            // Setup room if needed
            await this.setupRoom(roomName);
            
            const participantIdentity = `twilio-bridge-${conferenceId}`;
            
            const at = new AccessToken(
                this.apiKey,
                this.apiSecret,
                { identity: participantIdentity }
            );

            at.addGrant({
                roomJoin: true,
                room: roomName,
                canPublish: true,
                canSubscribe: true
            });

            const token = await at.toJwt();
            console.log(`Created token for ${participantIdentity}`);
            
            // Store connection info immediately
            this.activeStreams.set(conferenceId, {
                roomName,
                participantIdentity,
                status: 'connecting',
                token,
                audioBuffer: []
            });

            // Start room connection process asynchronously
            this.connectToRoom(conferenceId, roomName, token).catch(error => {
                console.error('Error in room connection:', error);
            });

            return {
                token,
                participantIdentity
            };

        } catch (error) {
            console.error('Error creating stream to room:', error);
            throw error;
        }
    }

    async connectToRoom(conferenceId, roomName, token) {
        try {
            // Connect to room via HTTP protocol
            const response = await fetch(`${this.livekitHost.replace('wss', 'https')}/rtc/join`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    room: roomName,
                    identity: `twilio-bridge-${conferenceId}`,
                    metadata: JSON.stringify({
                        type: 'twilio-bridge'
                    })
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to join room: ${response.statusText}`);
            }

            const joinResponse = await response.json();
            console.log('Joined room:', joinResponse);

            // Update stream status
            const streamInfo = this.activeStreams.get(conferenceId);
            if (streamInfo) {
                streamInfo.status = 'connected';
                streamInfo.joinResponse = joinResponse;
                console.log(`Room connection established for ${conferenceId}`);

                // Process any buffered audio
                if (streamInfo.audioBuffer && streamInfo.audioBuffer.length > 0) {
                    console.log(`Processing ${streamInfo.audioBuffer.length} buffered audio packets`);
                    for (const audioData of streamInfo.audioBuffer) {
                        await this.publishAudioData(conferenceId, audioData);
                    }
                    streamInfo.audioBuffer = [];
                }
            }

        } catch (error) {
            console.error('Error connecting to room:', error);
            throw error;
        }
    }

    async handleAudioData(conferenceId, audioData) {
        console.log('Handling audio data for conference:', conferenceId);
        console.log('Audio buffer size:', streamInfo.audioBuffer.length);

        const streamInfo = this.activeStreams.get(conferenceId);
        if (!streamInfo) {
            console.warn(`No active stream found for conference ${conferenceId}`);
            return;
        }

        try {
            if (streamInfo.status === 'connecting') {
                // Buffer audio while connection is establishing
                streamInfo.audioBuffer.push(audioData);
                return;
            }

            await this.publishAudioData(conferenceId, audioData);

        } catch (error) {
            console.error(`Error handling audio data for ${conferenceId}:`, error);
        }
    }

    async publishAudioData(conferenceId, audioData) {
        const streamInfo = this.activeStreams.get(conferenceId);
        if (!streamInfo || !streamInfo.joinResponse) return;

        try {
            // Publish audio data via HTTP
            const response = await fetch(`${this.livekitHost.replace('wss', 'https')}/rtc/publish`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${streamInfo.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    room: streamInfo.roomName,
                    track: 'audio',
                    data: audioData
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to publish audio: ${response.statusText}`);
            }

        } catch (error) {
            console.error('Error publishing audio:', error);
        }
    }

    async stopStream(conferenceId) {
        try {
            const streamInfo = this.activeStreams.get(conferenceId);
            if (streamInfo) {
                // Leave room via HTTP
                const response = await fetch(`${this.livekitHost.replace('wss', 'https')}/rtc/leave`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${streamInfo.token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        room: streamInfo.roomName,
                        identity: streamInfo.participantIdentity
                    })
                });

                this.activeStreams.delete(conferenceId);
                this.pendingAudio.delete(conferenceId);
                console.log(`Stream stopped for conference ${conferenceId}`);
            }
        } catch (error) {
            console.error('Error stopping stream:', error);
        }
    }
}

module.exports = WebRTCBridge;