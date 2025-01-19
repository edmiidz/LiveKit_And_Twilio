const result = require('dotenv').config();
const { AccessToken } = require('livekit-server-sdk');
const { RoomServiceClient } = require('livekit-server-sdk');

// Create this as test.js in your project root
async function testLiveKit() {
    try {
        console.log('Testing LiveKit connection...');
        
        // First test the RoomService
        const roomService = new RoomServiceClient(
            'wss://nik-p2d5buve.livekit.cloud',
            process.env.LIVEKIT_API_KEY,
            process.env.LIVEKIT_API_SECRET
        );

        // Try to list rooms
        console.log('Attempting to list rooms...');
        const rooms = await roomService.listRooms();
        console.log('Rooms:', rooms);

        // Create a test token
        const at = new AccessToken(
            process.env.LIVEKIT_API_KEY,
            process.env.LIVEKIT_API_SECRET,
            {
                identity: 'test-user'
            }
        );

        at.addGrant({
            roomJoin: true,
            room: 'test-room'
        });

        const token = await at.toJwt();
        console.log('Generated test token:', token);

    } catch (error) {
        console.error('LiveKit test failed:', error);
    }
}

testLiveKit();