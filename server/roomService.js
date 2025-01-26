// server/roomService.js
const twilio = require('twilio');
const { AccessToken, SipClient } = require('livekit-server-sdk');

class RoomService {
    constructor({ twilioAccountSid, twilioAuthToken, twilioPhoneNumber, baseUrl, livekitApiKey, livekitApiSecret, livekitWsUrl }) {
        this.twilioClient = twilio(twilioAccountSid, twilioAuthToken);
        this.twilioPhoneNumber = twilioPhoneNumber;
        this.baseUrl = baseUrl;
        this.livekitApiKey = livekitApiKey;
        this.livekitApiSecret = livekitApiSecret;
        this.livekitWsUrl = livekitWsUrl;
    }

    async dialOutToPhone(phoneNumber, roomName) {
        if (!this.baseUrl) {
            throw new Error('BASE_URL environment variable is not set');
        }

        try {
            const sipClient = new SipClient(this.livekitWsUrl, this.livekitApiKey, this.livekitApiSecret);
            const trunkId = process.env.TWILIO_SIP_TRUNK_SID;

            const participant = sipClient.createSipParticipant(trunkId, phoneNumber, roomName, {
                participantIdentity: `sip-${phoneNumber}`,
                participantName: `sip-${phoneNumber}`,
                playDialtone: true
            });

            return { success: true, participant };
        } catch (error) {
            console.error('Error dialing out:', error);
            return { success: false, error: error.message };
        }
    }

    generateLiveKitToken(participantName, roomName) {
        const token = new AccessToken(this.livekitApiKey, this.livekitApiSecret, {
            identity: participantName,
            ttl: '1h'
        });

        token.addGrant({ admin: true, call: true });
        token.addGrant({
            roomJoin: true,
            room: roomName,
            canPublish: true,
            canSubscribe: true
        });

        return token.toJwt();
    }

    async handleConferenceEvent(event) {
        const { StatusCallbackEvent: eventType, ConferenceSid: conferenceSid } = event;

        console.log('Processing conference event:', event);

        try {
            switch (eventType) {
                case 'participant-join':
                    console.log(`Participant joined conference ${conferenceSid}`);
                    break;
                case 'participant-leave':
                    console.log(`Participant left conference ${conferenceSid}`);
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
