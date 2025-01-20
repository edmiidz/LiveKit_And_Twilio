// server/WebRTCBridge.js
const { RoomServiceClient, AccessToken } = require('livekit-server-sdk');

class WebRTCBridge {
    constructor(config) {
        if (!config.livekitHost || !config.apiKey || !config.apiSecret) {
            throw new Error('Missing required LiveKit configuration');
        }

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
        if (!conferenceId || !roomName) {
            throw new Error('Missing required parameters: conferenceId or roomName');
        }

        console.log(`Creating audio bridge for conference ${conferenceId} to room ${roomName}`);
        
        try {
            // First set up preliminary stream info
            this.activeStreams.set(conferenceId, {
                roomName,
                status: 'initializing',
                audioBuffer: [],
                createdAt: Date.now()
            });

            // Create room (if it fails because it exists, that's fine)
            try {
                await this.roomService.createRoom({
                    name: roomName,
                    emptyTimeout: 300,
                    maxParticipants: 20
                });
                console.log(`Created LiveKit room: ${roomName}`);
            } catch (error) {
                if (!error.message.includes('already exists')) {
                    throw error;
                }
                console.log(`Room ${roomName} already exists`);
            }

            // Create participant token
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
            console.log(`Generated token for participant twilio-bridge-${conferenceId}`);

            // Update stream info
            const streamInfo = this.activeStreams.get(conferenceId);
            if (!streamInfo) {
                throw new Error('Stream info was unexpectedly removed');
            }

            streamInfo.token = token;
            streamInfo.status = 'connected';
            
            console.log(`Successfully created audio bridge for conference ${conferenceId}`);
            return { token, roomName };

        } catch (error) {
            console.error(`Failed to create stream to room: ${error.message}`);
            // Clean up on error
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

        try {
            if (streamInfo.status !== 'connected') {
                console.log(`Stream ${conferenceId} not ready (status: ${streamInfo.status}). Buffering audio.`);
                streamInfo.audioBuffer.push({
                    data: audioData,
                    track,
                    timestamp: Date.now()
                });
                return;
            }

            // Add your audio processing logic here
            console.log(`Processing ${track} audio for conference ${conferenceId}`);
            // For now, just acknowledge receipt
            return true;

        } catch (error) {
            console.error(`Error handling audio data: ${error.message}`);
            streamInfo.status = 'error';
            streamInfo.error = error;
            throw error;
        }
    }

    async stopStream(conferenceId) {
        try {
            const streamInfo = this.activeStreams.get(conferenceId);
            if (streamInfo) {
                console.log(`Stopping stream for conference ${conferenceId}`);
                
                try {
                    await this.roomService.deleteRoom(streamInfo.roomName);
                    console.log(`Deleted room ${streamInfo.roomName}`);
                } catch (error) {
                    console.warn(`Error deleting room: ${error.message}`);
                }
                
                this.activeStreams.delete(conferenceId);
                console.log(`Stream stopped for conference ${conferenceId}`);
            }
        } catch (error) {
            console.error(`Error stopping stream: ${error.message}`);
            throw error;
        }
    }
}

module.exports = WebRTCBridge;