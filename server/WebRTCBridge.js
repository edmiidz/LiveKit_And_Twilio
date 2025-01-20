// server/WebRTCBridge.js
const { RoomServiceClient, AccessToken } = require('livekit-server-sdk');
const WebSocket = require('ws');

class WebRTCBridge {
    constructor(config) {
        console.log('WebRTCBridge Constructor - Config:', JSON.stringify(config, null, 2));

        // Validate configuration
        if (!config.livekitHost || !config.apiKey || !config.apiSecret) {
            throw new Error('Invalid LiveKit configuration. Missing required parameters.');
        }

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
            console.log(`[SETUP] Attempting to set up room: ${roomName}`);
            
            // Check if room already exists
            const rooms = await this.roomService.listRooms();
            const existingRoom = rooms.find(r => r.name === roomName);
            
            if (!existingRoom) {
                // Create room if it doesn't exist
                const newRoom = await this.roomService.createRoom({
                    name: roomName,
                    emptyTimeout: 300, // 5 minutes timeout
                    maxParticipants: 10
                });
                console.log(`[SETUP] Created new LiveKit room: ${roomName}`, newRoom);
            } else {
                console.log(`[SETUP] Room already exists: ${roomName}`);
            }
            
            return true;
        } catch (error) {
            console.error(`[SETUP] Error setting up room ${roomName}:`, error);
            throw error;
        }
    }

    async createStreamToRoom(conferenceId, roomName, options = {}) {
        console.log('[CREATE STREAM] Attempting to create stream', {
            conferenceId,
            roomName,
            options: JSON.stringify(options)
        });

        try {
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
            console.log(`[CREATE STREAM] Created token for ${participantIdentity}`);
            
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
            console.log('[CREATE STREAM] Storing stream info', JSON.stringify(streamInfo, null, 2));
            
            this.activeStreamsByConference.set(conferenceId, streamInfo);
            
            // If streamSid is provided, also store by streamSid
            if (options.streamSid) {
                this.activeStreamsByStreamSid.set(options.streamSid, streamInfo);
            }
            
            console.log('[CREATE STREAM] Stream Maps After Storage:', {
                conferenceKeys: Array.from(this.activeStreamsByConference.keys()),
                streamSidKeys: Array.from(this.activeStreamsByStreamSid.keys())
            });

            return {
                token,
                participantIdentity,
                roomName
            };

        } catch (error) {
            console.error('[CREATE STREAM] Error creating stream to room:', error);
            
            // Log additional context about the error
            console.error('[CREATE STREAM] Error Context', {
                conferenceId,
                roomName,
                apiKey: this.apiKey ? 'Set' : 'Unset',
                apiSecret: this.apiSecret ? 'Set' : 'Unset',
                livekitHost: this.livekitHost
            });

            throw error;
        }
    }

    getStreamInfo(conferenceId, options = {}) {
        console.log('[GET STREAM INFO] Attempting to find stream', {
            conferenceId,
            options: JSON.stringify(options)
        });

        // Try to find stream by conferenceId first
        let streamInfo = this.activeStreamsByConference.get(conferenceId);
        
        // If not found, try by streamSid
        if (!streamInfo && options.streamSid) {
            streamInfo = this.activeStreamsByStreamSid.get(options.streamSid);
        }

        if (!streamInfo) {
            console.warn(`[GET STREAM INFO] No stream found for conference ${conferenceId}`, {
                conferenceKeys: Array.from(this.activeStreamsByConference.keys()),
                streamSidKeys: Array.from(this.activeStreamsByStreamSid.keys())
            });
        }

        return streamInfo;
    }

    // Rest of the methods remain the same as in the previous version...

    // Add a debug method to print out all current streams
    debugPrintStreams() {
        console.log('=== DEBUG: CURRENT STREAMS ===');
        console.log('Streams by Conference ID:');
        this.activeStreamsByConference.forEach((stream, key) => {
            console.log(`Conference ID: ${key}`, JSON.stringify(stream, null, 2));
        });

        console.log('Streams by Stream SID:');
        this.activeStreamsByStreamSid.forEach((stream, key) => {
            console.log(`Stream SID: ${key}`, JSON.stringify(stream, null, 2));
        });
        console.log('=== END OF STREAM DEBUG ===');
    }
}

module.exports = WebRTCBridge;