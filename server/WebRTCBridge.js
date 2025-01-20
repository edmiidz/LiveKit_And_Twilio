// server/WebRTCBridge.js
const { AccessToken } = require('livekit-server-sdk');
const fetch = require('node-fetch');

class WebRTCBridge {
    constructor(config) {
        if (!config.livekitHost || !config.apiKey || !config.apiSecret) {
            throw new Error('Missing required LiveKit configuration');
        }

        this.baseUrl = `https://${config.livekitHost.replace('wss://', '')}`;
        this.apiKey = config.apiKey;
        this.apiSecret = config.apiSecret;
        this.activeStreams = new Map();
    }

    async createStreamToRoom(conferenceId, roomName) {
        console.log(`Initializing stream for conference ${conferenceId} to room ${roomName}`);
        
        try {
            // Create room using direct REST API call
            const createRoomUrl = `${this.baseUrl}/twirp/livekit.RoomService/CreateRoom`;
            const createRoomResponse = await fetch(createRoomUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}:${this.apiSecret}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: roomName,
                    empty_timeout: 300,
                    max_participants: 20
                })
            });

            if (!createRoomResponse.ok) {
                const errorText = await createRoomResponse.text();
                console.log('Create room response:', errorText);
                if (!errorText.includes('already exists')) {
                    throw new Error(`Failed to create room: ${errorText}`);
                }
            }

            // Create token
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
            console.log(`Generated token for ${conferenceId}`);

            // Store stream info
            this.activeStreams.set(conferenceId, {
                roomName,
                token,
                status: 'connected',
                audioBuffer: [],
                createdAt: Date.now()
            });

            console.log(`Successfully created audio bridge for conference ${conferenceId}`);
            return { token, roomName };

        } catch (error) {
            console.error(`Failed to create stream: ${error.message}`);
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

        // Just log for now to debug connection
        console.log(`Received ${track} audio for conference ${conferenceId} (${streamInfo.status})`);
        return true;
    }

    async stopStream(conferenceId) {
        const streamInfo = this.activeStreams.get(conferenceId);
        if (streamInfo) {
            try {
                const deleteRoomUrl = `${this.baseUrl}/twirp/livekit.RoomService/DeleteRoom`;
                await fetch(deleteRoomUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}:${this.apiSecret}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        name: streamInfo.roomName
                    })
                });
            } catch (error) {
                console.warn(`Error deleting room: ${error.message}`);
            }

            this.activeStreams.delete(conferenceId);
            console.log(`Stream stopped for conference ${conferenceId}`);
        }
    }
}

module.exports = WebRTCBridge;