// server/AudioBridge.js
const { RoomServiceClient } = require('livekit-server-sdk');

class AudioBridge {
    constructor(config) {
        this.roomService = new RoomServiceClient(
            config.livekitHost,
            config.apiKey,
            config.apiSecret
        );
        this.activeStreams = new Map();
    }

    async createStreamToRoom(conferenceId, roomName) {
        try {
            console.log(`Creating audio bridge for conference ${conferenceId} to room ${roomName}`);
            
            // Join the LiveKit room as a service participant
            const participantIdentity = `twilio-bridge-${conferenceId}`;
            const accessToken = await this.roomService.createToken({
                identity: participantIdentity,
                name: 'Phone Participant',
                metadata: JSON.stringify({ type: 'twilio-bridge' }),
                roomName: roomName,
                ttl: 3600 // 1 hour
            });

            // Store the stream information
            this.activeStreams.set(conferenceId, {
                roomName,
                participantIdentity,
                status: 'connecting'
            });

            console.log(`Created bridge token for ${participantIdentity} in room ${roomName}`);

            return {
                accessToken,
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
                // First audio packet, establish WebRTC connection
                try {
                    await this.roomService.sendData(
                        streamInfo.roomName,
                        audioData,
                        [streamInfo.participantIdentity]
                    );
                    streamInfo.status = 'connected';
                    console.log(`Audio bridge established for conference ${conferenceId}`);
                } catch (error) {
                    console.error('Error establishing audio bridge:', error);
                }
            } else {
                // Forward audio data to LiveKit room
                await this.roomService.sendData(
                    streamInfo.roomName,
                    audioData,
                    [streamInfo.participantIdentity]
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
                // Remove participant from LiveKit room
                await this.roomService.removeParticipant(
                    streamInfo.roomName,
                    streamInfo.participantIdentity
                );
                this.activeStreams.delete(conferenceId);
                console.log(`Stopped stream successfully for conference ${conferenceId}`);
            }
        } catch (error) {
            console.error('Error stopping stream:', error);
        }
    }
}

module.exports = AudioBridge;