// server/WebRTCBridge.js
const { RoomServiceClient, AccessToken } = require('livekit-server-sdk');
const { Room } = require('livekit-client');
const WebSocket = require('ws');
// Improved WebRTCBridge class
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
        this.connectionAttempts = new Map();
    }

    async createStreamToRoom(conferenceId, roomName) {
        try {
            console.log(`Creating audio bridge for conference ${conferenceId} to room ${roomName}`);
            
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
            
            // Create a promise that resolves when connection is established
            const connectionPromise = new Promise((resolve, reject) => {
                this.connectionAttempts.set(conferenceId, { resolve, reject, attempts: 0 });
            });

            // Store connection info
            this.activeStreams.set(conferenceId, {
                roomName,
                participantIdentity,
                status: 'connecting',
                token,
                audioBuffer: [],
                connectionPromise
            });

            // Start room connection process
            this.connectToRoom(conferenceId, roomName, token).catch(error => {
                console.error('Error in room connection:', error);
                const connectionAttempt = this.connectionAttempts.get(conferenceId);
                if (connectionAttempt) {
                    connectionAttempt.reject(error);
                }
                this.activeStreams.delete(conferenceId);
                this.connectionAttempts.delete(conferenceId);
            });

            // Wait for connection with timeout
            await Promise.race([
                connectionPromise,
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Room connection timeout')), 10000)
                )
            ]);

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

                // Resolve connection promise
                const connectionAttempt = this.connectionAttempts.get(conferenceId);
                if (connectionAttempt) {
                    connectionAttempt.resolve(joinResponse);
                    this.connectionAttempts.delete(conferenceId);
                }

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
            const connectionAttempt = this.connectionAttempts.get(conferenceId);
            if (connectionAttempt) {
                connectionAttempt.reject(error);
                this.connectionAttempts.delete(conferenceId);
            }
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
                console.log(`Buffered audio packet. Current buffer size: ${streamInfo.audioBuffer.length}`);
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