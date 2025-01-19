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
            
            return true;
        } catch (error) {
            console.error(`Error setting up room ${roomName}:`, error);
            throw error;
        }
    }

    async createStreamToRoom(conferenceId, roomName, options = {}) {
        try {
            console.log(`Creating audio bridge for conference ${conferenceId} to room ${roomName}`);
            
            // Setup room before creating stream
            await this.setupRoom(roomName);
            
            const participantIdentity = options.participantIdentity || 
                `twilio-bridge-${conferenceId}`;
            
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
            
            // Comprehensive stream info
            const streamInfo = {
                roomName,
                conferenceId,
                participantIdentity,
                status: 'initialized',
                token,
                audioBuffer: [],
                createdAt: Date.now(),
                tracks: options.tracks || ['inbound', 'outbound'],
                mediaFormat: options.mediaFormat || null
            };
            
            // Store stream info, ensuring it's retrievable
            this.activeStreams.set(conferenceId, streamInfo);
            
            // Optional: Also store by streamSid if provided
            if (options.streamSid) {
                this.activeStreams.set(options.streamSid, streamInfo);
            }
            
            console.log(`Stream info stored for conference ${conferenceId}:`, streamInfo);

            return {
                token,
                participantIdentity,
                roomName
            };

        } catch (error) {
            console.error('Error creating stream to room:', error);
            throw error;
        }
    }

    async handleAudioData(conferenceId, audioData, options = {}) {
        console.log('Handling audio data for conference:', conferenceId);

        // Try to find stream by conferenceId or streamSid
        let streamInfo = this.activeStreams.get(conferenceId);
        
        if (!streamInfo && options.streamSid) {
            streamInfo = this.activeStreams.get(options.streamSid);
        }

        if (!streamInfo) {
            console.warn(`No active stream found for conference ${conferenceId}. 
                Available keys: ${Array.from(this.activeStreams.keys()).join(', ')}`);
            
            // Attempt to create stream if not exists
            try {
                await this.createStreamToRoom(conferenceId, 'support-room', {
                    streamSid: options.streamSid,
                    tracks: options.tracks,
                    mediaFormat: options.mediaFormat
                });
                
                // Retry getting stream info
                streamInfo = this.activeStreams.get(conferenceId);
            } catch (error) {
                console.error('Failed to create stream:', error);
                return;
            }
        }

        try {
            if (streamInfo.status === 'initialized') {
                // Buffer audio while connection is establishing
                streamInfo.audioBuffer.push({
                    data: audioData,
                    timestamp: Date.now(),
                    track: options.track || 'unknown'
                });
                console.log(`Buffered audio packet. Current buffer size: ${streamInfo.audioBuffer.length}`);
                return;
            }

            await this.publishAudioData(conferenceId, audioData, options);

        } catch (error) {
            console.error(`Error handling audio data for ${conferenceId}:`, error);
        }
    }

    async publishAudioData(conferenceId, audioData, options = {}) {
        const streamInfo = this.activeStreams.get(conferenceId);
        if (!streamInfo) {
            console.warn(`Cannot publish audio - no stream found for ${conferenceId}`);
            return;
        }

        try {
            console.log(`Publishing audio data for conference ${conferenceId}`);
            console.log('Audio data details:', {
                length: audioData.length,
                track: options.track,
                timestamp: options.timestamp
            });

            // Placeholder for actual audio publishing
            // Implement your specific audio publishing logic here

        } catch (error) {
            console.error('Error publishing audio:', error);
        }
    }

    async stopStream(conferenceId, options = {}) {
        try {
            const streamInfo = this.activeStreams.get(conferenceId);
            if (streamInfo) {
                // Remove from both conferenceId and potential streamSid
                this.activeStreams.delete(conferenceId);
                if (options.streamSid) {
                    this.activeStreams.delete(options.streamSid);
                }
                
                console.log(`Stream stopped for conference ${conferenceId}`);
            } else {
                console.warn(`No stream found to stop for conference ${conferenceId}`);
            }
        } catch (error) {
            console.error('Error stopping stream:', error);
        }
    }

    // Utility method to list and debug active streams
    listActiveStreams() {
        console.log('Active Streams:');
        this.activeStreams.forEach((streamInfo, key) => {
            console.log(`Key: ${key}`, JSON.stringify(streamInfo, null, 2));
        });
    }
}

module.exports = WebRTCBridge;