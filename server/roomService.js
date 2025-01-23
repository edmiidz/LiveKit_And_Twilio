// server/roomService.js
const twilio = require('twilio');
const { AccessToken, SipClient } = require('livekit-server-sdk');

class RoomService {
    constructor(config) {
        this.twilioClient = twilio(config.twilioAccountSid, config.twilioAuthToken);
        this.twilioPhoneNumber = config.twilioPhoneNumber;
        this.baseUrl = config.baseUrl;
        this.livekitApiKey = config.livekitApiKey;
        this.livekitApiSecret = config.livekitApiSecret;
        this.livekitWsUrl = config.livekitWsUrl;
    }

    async storeBridgeParticipant(conferenceSid, participantSid) {
        if (!this.bridgeParticipants) {
            this.bridgeParticipants = new Map();
        }
        this.bridgeParticipants.set(conferenceSid, participantSid);
        console.log(`Stored bridge participant ${participantSid} for conference ${conferenceSid}`);
    }

    async dialOutToPhone(phoneNumber, roomName) {
        try {
            if (!this.baseUrl) {
                throw new Error('BASE_URL environment variable is not set');
            }

            const sipClient = new SipClient(this.livekitWsUrl, this.livekitApiKey, this.livekitApiSecret);

            // Outbound trunk to use for the call
            const trunkId = 'ST_dEr5LeW3kZqS';

            const sipParticipantOptions = {
                participantIdentity: `sip-${phoneNumber}`,
                participantName: `sip-${phoneNumber}`,
                playDialtone: true
            };

            const participant = sipClient.createSipParticipant(
                trunkId,
                phoneNumber,
                roomName,
                sipParticipantOptions
            );

            return { success: true, participant: participant };
        } catch (error) {
            console.error('Error dialing out:', error);
            return { success: false, error: error.message };
        }
    }

    generateLiveKitToken(participantName, roomName) {
        const at = new AccessToken(
            this.livekitApiKey,
            this.livekitApiSecret,
            {
                identity: participantName,
                ttl: '1h'
            }
        );

        const sipGrant = {
            admin: true,
            call: true,
        };

        at.addGrant(sipGrant);

        at.addGrant({
            roomJoin: true,
            room: roomName,
            canPublish: true,
            canSubscribe: true
        });

        return at.toJwt();
    }

    async handleConferenceEvent(event) {
        try {
            console.log('Processing conference event:', event);

            const eventType = event.StatusCallbackEvent;
            const conferenceSid = event.ConferenceSid;

            switch (eventType) {
                case 'participant-join':
                    console.log(`Participant joined conference ${conferenceSid}`);
                    // Here you would implement the logic to bridge the audio to LiveKit
                    break;

                case 'participant-leave':
                    console.log(`Participant left conference ${conferenceSid}`);
                    // Clean up any LiveKit connections
                    break;

                case 'conference-start':
                    console.log(`Conference ${conferenceSid} started`);
                    break;

                case 'conference-end':
                    console.log(`Conference ${conferenceSid} ended`);
                    break;

                default:
                    console.log(`Unhandled conference event: ${eventType}`);
            }

            return true;
        } catch (error) {
            console.error('Error handling conference event:', error);
            return false;
        }
    }
}

module.exports = RoomService;