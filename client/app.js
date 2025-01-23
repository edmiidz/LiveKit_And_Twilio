// client/app.js
// client/app.js
import { Room, RoomEvent } from 'livekit-client';

let room;
let microphoneEnabled = false;
let currentAudioElement = null;

function updateParticipantList() {
    const participantsList = document.getElementById('participants');
    participantsList.innerHTML = '';

    if (room) {
        const localParticipant = room.localParticipant;
        const localDiv = document.createElement('div');
        localDiv.textContent = `👤 ${localParticipant.identity} (You) ${microphoneEnabled ? '🎤' : ''}`;
        participantsList.appendChild(localDiv);

        room.participants.forEach(participant => {
            const div = document.createElement('div');
            div.textContent = `👤 ${participant.identity}`;
            participantsList.appendChild(div);
        });
    }
}

async function enableMicrophone() {
    try {
        if (!room) {
            alert('Please join the room first');
            return;
        }

        // Request microphone access
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        });

        // Publish microphone track with a specific name
        const track = stream.getAudioTracks()[0];

        // Make sure we give it the correct name and source
        const trackPublication = await room.localParticipant.publishTrack(track, {
            name: 'microphone',
            source: 'microphone',
            dtx: true,
            stopMicrophoneOnMute: false  // Important: Keep the track alive when muted
        });

        console.log('Microphone track published:', trackPublication);
        microphoneEnabled = true;

        // Set initial mute button state
        const muteBtn = document.getElementById('muteBtn');
        muteBtn.textContent = 'Unmuted';
        muteBtn.classList.remove('muted');
        muteBtn.classList.add('unmuted');

        updateParticipantList();

    } catch (error) {
        console.error('Error enabling microphone:', error);
        alert('Failed to enable microphone: ' + error.message);
    }
}

async function handleSendAudio() {
    try {
        if (!room) {
            alert('Please join the room first');
            return;
        }

        const fileInput = document.getElementById('fileInput');
        if (!fileInput.files.length) {
            alert('Please select an audio file first');
            return;
        }

        const file = fileInput.files[0];
        console.log('Broadcasting audio file:', file.name);

        // Stop any currently playing audio
        if (currentAudioElement) {
            currentAudioElement.pause();
            currentAudioElement.srcObject = null;
            currentAudioElement = null;
        }

        const audio = new Audio();
        audio.src = URL.createObjectURL(file);
        currentAudioElement = audio;

        // Wait for the audio to be loaded
        await new Promise((resolve) => {
            audio.addEventListener('loadedmetadata', resolve);
        });

        const audioContext = new AudioContext();
        const source = audioContext.createMediaElementSource(audio);
        const destination = audioContext.createMediaStreamDestination();
        source.connect(destination);
        source.connect(audioContext.destination); // This allows the sender to hear the audio

        const track = destination.stream.getAudioTracks()[0];
        await room.localParticipant.publishTrack(track, {
            name: 'audio-file',  // Give the track a specific name
            stopOnEnd: true
        });

        audio.play();
        console.log('Audio broadcasting started');

        audio.addEventListener('ended', async () => {
            console.log('Audio playback ended');
            track.stop();
            await room.localParticipant.unpublishTrack(track);
            audioContext.close();
            currentAudioElement = null;
        });
    } catch (error) {
        console.error('Error broadcasting audio:', error);
        alert('Failed to broadcast audio: ' + error.message);
    }
}

async function connectToRoom() {
    try {
        console.log('Attempting to connect to room...');

        const response = await fetch('/join-room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                roomName: 'support-room',
                participantName: `user-${Math.random().toString(36).substr(2, 5)}`
            })
        });

        const data = await response.json();
        console.log('Server response:', data);

        if (!data.token) {
            throw new Error('No token received from server');
        }

        room = new Room();

        room.on(RoomEvent.ParticipantConnected, () => {
            console.log('Participant connected');
            updateParticipantList();
        });

        room.on(RoomEvent.ParticipantDisconnected, () => {
            console.log('Participant disconnected');
            updateParticipantList();
        });

        room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
            if (track.kind === 'audio') {
                console.log('Received audio track from:', participant.identity);
                track.attach();
            }
        });

        room.on(RoomEvent.TrackUnsubscribed, (track) => {
            if (track.kind === 'audio') {
                console.log('Audio track unsubscribed');
                track.detach();
            }
        });

        const wsUrl = 'wss://twilio-i90onacj.livekit.cloud';
        console.log('Connecting to LiveKit room at:', wsUrl);

        await room.connect(wsUrl, data.token);
        console.log('Connected to room successfully!');

        // Enable microphone automatically when joining
        await enableMicrophone();

        updateParticipantList();

        document.getElementById('joinBtn').disabled = true;
        document.getElementById('leaveBtn').disabled = false;

    } catch (error) {
        console.error('Connection error:', error);
        alert('Failed to connect: ' + error.message);
    }
}

async function leaveRoom() {
    try {
        if (room) {
            console.log('Leaving room...');
            if (currentAudioElement) {
                currentAudioElement.pause();
                currentAudioElement = null;
            }
            await room.disconnect();
            room = null;
            microphoneEnabled = false;
            console.log('Left room successfully');
        }
        document.getElementById('joinBtn').disabled = false;
        document.getElementById('leaveBtn').disabled = true;
        document.getElementById('muteBtn').textContent = 'Mute';
        updateParticipantList();
    } catch (error) {
        console.error('Error leaving room:', error);
        alert('Failed to leave room: ' + error.message);
    }
}

async function toggleMute() {
    if (!room || !room.localParticipant) {
        console.warn('Room or local participant not available');
        return;
    }

    try {
        // Find the microphone track
        const audioTracks = Array.from(room.localParticipant.tracks.values())
            .filter(publication => publication.kind === 'audio' && publication.source === 'microphone');

        if (audioTracks.length === 0) {
            console.warn('No microphone track found');
            return;
        }

        const audioTrack = audioTracks[0];
        console.log('Current track mute state:', audioTrack.isMuted ? 'muted' : 'unmuted');

        if (audioTrack.isMuted) {
            // We're unmuting
            await room.localParticipant.setMicrophoneEnabled(true);
            const muteBtn = document.getElementById('muteBtn');
            muteBtn.textContent = 'Unmuted';
            muteBtn.classList.remove('muted');
            muteBtn.classList.add('unmuted');
            console.log('Microphone unmuted using setMicrophoneEnabled');
        } else {
            // We're muting
            await audioTrack.mute();
            const muteBtn = document.getElementById('muteBtn');
            muteBtn.textContent = 'Muted';
            muteBtn.classList.remove('unmuted');
            muteBtn.classList.add('muted');
            console.log('Microphone muted at track level');
        }

        console.log('Post-toggle track state:', audioTrack.isMuted ? 'muted' : 'unmuted');
        updateParticipantList();
    } catch (error) {
        console.error('Error toggling mute:', error);
        alert('Failed to toggle mute. Please try reconnecting to the room.');
    }
}


async function handleDialOut() {
    try {
        if (!room) {
            alert('Please join the room first');
            return;
        }

        const phoneNumber = document.getElementById('phonenumber').value;
        if (!phoneNumber) {
            alert('Please enter a phone number');
            return;
        }

        const response = await fetch('/dial-out', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phoneNumber,
                roomName: 'support-room'  // Use the same room name as your LiveKit room
            })
        });

        const result = await response.json();
        if (result.success) {
            console.log('Successfully initiated call:', result.callSid);
            alert('Phone call initiated successfully');
        } else {
            throw new Error(result.error);
        }
    } catch (error) {
        console.error('Error dialing out:', error);
        alert('Failed to initiate phone call: ' + error.message);
    }
}




document.addEventListener('DOMContentLoaded', () => {
    console.log('Setting up event listeners...');

    document.getElementById('joinBtn').addEventListener('click', connectToRoom);
    document.getElementById('leaveBtn').addEventListener('click', leaveRoom);
    document.getElementById('muteBtn').addEventListener('click', toggleMute);
    document.getElementById('sendBtn').addEventListener('click', handleSendAudio);
    document.getElementById('dialOutBtn').addEventListener('click', handleDialOut);
    document.getElementById('leaveBtn').disabled = true;
});