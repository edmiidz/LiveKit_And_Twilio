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
        
        // Use two maps for cross-referencing
        this.activeStreamsByConference = new Map();
        this.activeStreamsByStreamSid = new Map();
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
                mediaFormat: options.mediaFormat || null,
                streamSid: options.streamSid || null
            };
            
            // Store stream info in both maps
            this.activeStreamsByConference.set(conferenceId, streamInfo);
            
            // If streamSid is provided, also store by streamSid
            if (options.streamSid) {
                this.activeStreamsByStreamSid.set(options.streamSid, streamInfo);
            }
            
            console.log(`Stream info stored for conference ${conferenceId}:`, 
                JSON.stringify(streamInfo, null, 2));

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

    getStreamInfo(conferenceId, options = {}) {
        // Try to find stream by conferenceId first
        let streamInfo = this.activeStreamsByConference.get(conferenceId);
        
        // If not found, try by streamSid
        if (!streamInfo && options.streamSid) {
            streamInfo = this.activeStreamsByStreamSid.get(options.streamSid);
        }

        if (!streamInfo) {
            console.warn(`No stream found for conference ${conferenceId}`, {
                conferenceKeys: Array.from(this.activeStreamsByConference.keys()),
                streamSidKeys: Array.from(this.activeStreamsByStreamSid.keys())
            });
        }

        return streamInfo;
    }

    async handleAudioData(conferenceId, audioData, options = {}) {
        console.log('Handling audio data for conference:', conferenceId);

        // Use the new getStreamInfo method
        let streamInfo = this.getStreamInfo(conferenceId, options);

        // If no stream info, attempt to create one
        if (!streamInfo) {
            try {
                await this.createStreamToRoom(conferenceId, 'support-room', {
                    streamSid: options.streamSid,
                    tracks: options.tracks,
                    mediaFormat: options.mediaFormat
                });
                
                // Retry getting stream info
                streamInfo = this.getStreamInfo(conferenceId, options);
            } catch (error) {
                console.error('Failed to create stream:', error);
                return;
            }
        }

        // If still no stream info, log and return
        if (!streamInfo) {
            console.error('Could not find or create stream info');
            return;
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
        const streamInfo = this.getStreamInfo(conferenceId, options);
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
            const streamInfo = this.getStreamInfo(conferenceId, options);
            if (streamInfo) {
                // Remove from both maps
                this.activeStreamsByConference.delete(conferenceId);
                if (streamInfo.streamSid) {
                    this.activeStreamsByStreamSid.delete(streamInfo.streamSid);
                }
                
                console.log(`Stream stopped for conference ${conferenceId}`);
            } else {
                console.warn(`No stream found to stop for conference ${conferenceId}`);
            }
        } catch (error) {
            console.error('Error stopping stream:', error);
        }
    }

    // Debug method to list all active streams
    listActiveStreams() {
        console.log('Active Streams by Conference ID:');
        this.activeStreamsByConference.forEach((streamInfo, key) => {
            console.log(`Conference Key: ${key}`, JSON.stringify(streamInfo, null, 2));
        });

        console.log('Active Streams by Stream SID:');
        this.activeStreamsByStreamSid.forEach((streamInfo, key) => {
            console.log(`Stream SID Key: ${key}`, JSON.stringify(streamInfo, null, 2));
        });
    }
}

module.exports = WebRTCBridge;