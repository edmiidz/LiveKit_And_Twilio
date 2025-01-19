// server/WebRTCBridge.js
const { RoomServiceClient, AccessToken } = require('livekit-server-sdk');
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
    }

    // Add the missing setupRoom method
    async setupRoom(roomName) {
        try {
            console.log(`Attempting to set up room: ${roomName}`);
            
            // Check if room already exists
            const rooms = await this.roomService.listRooms();
            const existingRoom = rooms.find(r => r.name === roomName);
            
            if (!existingRoom) {
                // Create room if it doesn't exist
                await this.roomService.createRoom({
                    name: roomName,
                    emptyTimeout: 300, // 5 minutes timeout
                    maxParticipants: 10
                });
                console.log(`Created new LiveKit room: ${roomName}`);
            } else {
                console.log(`Room already exists: ${roomName}`);
            }
        } catch (error) {
            console.error(`Error setting up room ${roomName}:`, error);
            throw error;
        }
    }

    async createStreamToRoom(conferenceId, roomName) {
        try {
            console.log(`Creating audio bridge for conference ${conferenceId} to room ${roomName}`);
            
            // Setup room before creating stream
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
            
            // Store connection info
            this.activeStreams.set(conferenceId, {
                roomName,
                participantIdentity,
                status: 'connecting',
                token,
                audioBuffer: []
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

    async handleAudioData(conferenceId, audioData) {
        console.log('Handling audio data for conference:', conferenceId);

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
        if (!streamInfo) return;

        try {
            // Placeholder for actual audio publishing logic
            console.log(`Publishing audio data for conference ${conferenceId}`);
            // You'll need to implement the actual audio publishing mechanism here
        } catch (error) {
            console.error('Error publishing audio:', error);
        }
    }

    async stopStream(conferenceId) {
        try {
            const streamInfo = this.activeStreams.get(conferenceId);
            if (streamInfo) {
                this.activeStreams.delete(conferenceId);
                console.log(`Stream stopped for conference ${conferenceId}`);
            }
        } catch (error) {
            console.error('Error stopping stream:', error);
        }
    }
}

module.exports = WebRTCBridge;