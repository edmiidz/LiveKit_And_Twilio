// server/AudioBridge.js
const { RoomServiceClient, AccessToken } = require('livekit-server-sdk');

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
            
            // Create access token using AccessToken class
            const at = new AccessToken(
                this.apiKey,
                this.apiSecret,
                {
                    identity: participantIdentity,
                }
            );

            // Add grant for room access
            at.addGrant({
                roomJoin: true,
                room: roomName,
                canPublish: true,
                canSubscribe: true
            });

            const token = at.toJwt();

            // Store the stream information
            this.activeStreams.set(conferenceId, {
                roomName,
                participantIdentity,
                status: 'connecting',
                token
            });

            console.log(`Created bridge token for ${participantIdentity} in room ${roomName}`);

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
        try {
            const streamInfo = this.activeStreams.get(conferenceId);
            if (!streamInfo) {
                console.warn(`No active stream found for conference ${conferenceId}`);
                return;
            }

            if (streamInfo.status === 'connecting') {
                // First audio packet, establish connection
                try {
                    console.log(`Attempting to publish audio for conference ${conferenceId}`);
                    await this.roomService.publishData(
                        streamInfo.roomName,
                        Buffer.from(audioData)
                    );
                    streamInfo.status = 'connected';
                    console.log(`Audio bridge established for conference ${conferenceId}`);
                } catch (error) {
                    console.error('Error establishing audio bridge:', error);
                }
            } else {
                // Forward audio data to LiveKit room
                await this.roomService.publishData(
                    streamInfo.roomName,
                    Buffer.from(audioData)
                );
            }

        } catch (error) {
            console.error('Error handling audio data:', error);
        }
    }

    async stopStream(conferenceId) {
        try {
            console.log(`Stopping stream for conference ${conferenceId}`);
            const streamInfo = this.activeStreams.get(conferenceId);
            if (streamInfo) {
                try {
                    // Remove participant from LiveKit room
                    await this.roomService.removeParticipant(
                        streamInfo.roomName,
                        streamInfo.participantIdentity
                    );
                    console.log(`Removed participant ${streamInfo.participantIdentity} from room ${streamInfo.roomName}`);
                } catch (error) {
                    console.error('Error removing participant:', error);
                }
                this.activeStreams.delete(conferenceId);
                console.log(`Stopped stream successfully for conference ${conferenceId}`);
            }
        } catch (error) {
            console.error('Error stopping stream:', error);
        }
    }
}

module.exports = AudioBridge;