// server/WebRTCBridge.js
const { RoomServiceClient, AccessToken } = require('livekit-server-sdk');
const { Room } = require('livekit-client');

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
            
            // First, set up a preliminary entry to mark that we're setting up this stream
            this.activeStreams.set(conferenceId, {
                status: 'initializing',
                audioBuffer: []
            });
            
            await this.setupRoom(roomName);
            
            const participantIdentity = `twilio-bridge-${conferenceId}`;
            const at = new AccessToken(this.apiKey, this.apiSecret, { 
                identity: participantIdentity 
            });

            at.addGrant({
                roomJoin: true,
                room: roomName,
                canPublish: true,
                canSubscribe: true
            });

            const token = await at.toJwt();
            
            // Update stream info with the token
            const streamInfo = this.activeStreams.get(conferenceId);
            streamInfo.token = token;
            streamInfo.roomName = roomName;
            streamInfo.participantIdentity = participantIdentity;
            
            // Start connecting to the room
            try {
                await this.connectToRoom(conferenceId, roomName, token);
                streamInfo.status = 'connected';
                console.log(`Successfully connected stream for conference ${conferenceId}`);
            } catch (error) {
                console.error('Failed to connect to room:', error);
                streamInfo.status = 'error';
                streamInfo.error = error;
            }

            return { token, participantIdentity };

        } catch (error) {
            console.error('Error creating stream to room:', error);
            // Make sure we clean up on error
            this.activeStreams.delete(conferenceId);
            throw error;
        }
    }

    async handleAudioData(conferenceId, audioData) {
        const streamInfo = this.activeStreams.get(conferenceId);
        if (!streamInfo) {
            console.warn(`No active stream found for conference ${conferenceId}`);
            return;
        }

        // If we're still initializing, buffer the audio
        if (streamInfo.status === 'initializing') {
            console.log(`Buffering audio for conference ${conferenceId} while connecting...`);
            streamInfo.audioBuffer.push(audioData);
            return;
        }

        // If we're in an error state, log and return
        if (streamInfo.status === 'error') {
            console.warn(`Stream for conference ${conferenceId} is in error state, cannot process audio`);
            return;
        }

        // Only try to publish if we're connected
        if (streamInfo.status === 'connected' && streamInfo.room) {
            try {
                const track = await this.createAudioTrack(audioData);
                await streamInfo.room.localParticipant.publishTrack(track);
            } catch (error) {
                console.error('Error publishing audio track:', error);
                streamInfo.status = 'error';
                streamInfo.error = error;
            }
        }
    }

    async connectToRoom(conferenceId, roomName, token) {
        const streamInfo = this.activeStreams.get(conferenceId);
        if (!streamInfo) return;

        const room = new Room();
        
        // Set up room event handlers
        room.on('disconnected', () => {
            console.log(`Room disconnected for conference ${conferenceId}`);
            streamInfo.status = 'disconnected';
        });

        room.on('connected', () => {
            console.log(`Room connected for conference ${conferenceId}`);
            streamInfo.status = 'connected';
        });

        // Connect to the room
        await room.connect(this.livekitHost, token);
        streamInfo.room = room;
        
        // Process any buffered audio
        if (streamInfo.audioBuffer.length > 0) {
            console.log(`Processing ${streamInfo.audioBuffer.length} buffered audio packets`);
            for (const audioData of streamInfo.audioBuffer) {
                await this.handleAudioData(conferenceId, audioData);
            }
            streamInfo.audioBuffer = [];
        }
    }

    async createAudioTrack(audioData) {
        // Convert base64 to array buffer
        const buffer = Buffer.from(audioData, 'base64');
        
        // Create audio data
        const blob = new Blob([buffer], { type: 'audio/x-mulaw' });
        const audioTrack = new MediaStreamTrack();
        
        return audioTrack;
    }

    async stopStream(conferenceId) {
        const streamInfo = this.activeStreams.get(conferenceId);
        if (streamInfo) {
            if (streamInfo.room) {
                await streamInfo.room.disconnect();
            }
            this.activeStreams.delete(conferenceId);
            console.log(`Stream stopped for conference ${conferenceId}`);
        }
    }
}

module.exports = WebRTCBridge;