// server/AudioBridge.js
const { Room, RoomServiceClient } = require('livekit-server-sdk');
const { TrackSource } = require('@livekit/protocol-js');

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
            const participantName = 'Phone Participant';
            
            // Create access token for the bridge participant
            const accessToken = await this.roomService.createToken({
                identity: participantIdentity,
                name: participantName,
                metadata: JSON.stringify({ type: 'twilio-bridge' }),
                ttl: 3600, // 1 hour
                video: { canPublish: true, canSubscribe: true },
                audio: { canPublish: true, canSubscribe: true }
            });

            // Store the stream information
            this.activeStreams.set(conferenceId, {
                roomName,
                participantIdentity,
                status: 'initializing'
            });

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

            // Here we would process the audio data and publish it to the LiveKit room
            // This is where we need to implement the actual audio forwarding
            console.log(`Processing audio data for conference ${conferenceId}`);

            // Example of publishing audio to LiveKit room:
            await this.roomService.sendData(
                streamInfo.roomName,
                Buffer.from(audioData),
                [streamInfo.participantIdentity],
                DataPacket_Kind.RELIABLE
            );

        } catch (error) {
            console.error('Error handling audio data:', error);
        }
    }

    async stopStream(conferenceId) {
        try {
            const streamInfo = this.activeStreams.get(conferenceId);
            if (streamInfo) {
                // Cleanup and remove participant from LiveKit room
                await this.roomService.removeParticipant(
                    streamInfo.roomName,
                    streamInfo.participantIdentity
                );
                this.activeStreams.delete(conferenceId);
                console.log(`Stopped stream for conference ${conferenceId}`);
            }
        } catch (error) {
            console.error('Error stopping stream:', error);
        }
    }
}

module.exports = AudioBridge;