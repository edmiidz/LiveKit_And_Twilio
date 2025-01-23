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

async function requestMicrophoneAccess() {
    return navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
        },
        video: false,
    });
}

async function enableMicrophone() {
    try {
        if (!room) {
            alert('Please join the room first');
            return;
        }

        const stream = await requestMicrophoneAccess();
        const track = stream.getAudioTracks()[0];

        const trackPublication = await room.localParticipant.publishTrack(track, {
            name: 'microphone',
            source: 'microphone',
            dtx: true,
            stopMicrophoneOnMute: false,
        });

        console.log('Microphone track published:', trackPublication);
        microphoneEnabled = true;

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

async function playAudioFile(file) {
    const audio = new Audio();
    audio.src = URL.createObjectURL(file);
    currentAudioElement = audio;

    await new Promise(resolve => {
        audio.addEventListener('loadedmetadata', resolve);
    });

    const audioContext = new AudioContext();
    const source = audioContext.createMediaElementSource(audio);
    const destination = audioContext.createMediaStreamDestination();
    source.connect(destination);
    source.connect(audioContext.destination);

    return { audio, track: destination.stream.getAudioTracks()[0], audioContext };
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

        if (currentAudioElement) {
            currentAudioElement.pause();
            currentAudioElement = null;
        }

        const { audio, track, audioContext } = await playAudioFile(file);

        await room.localParticipant.publishTrack(track, {
            name: 'audio-file',
            stopOnEnd: true,
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
                participantName: `user-${Math.random().toString(36).substr(2, 5)}`,
            }),
        });

        const data = await response.json();
        if (!data.token) throw new Error('No token received from server');

        room = new Room();

        room.on(RoomEvent.ParticipantConnected, updateParticipantList);
        room.on(RoomEvent.ParticipantDisconnected, updateParticipantList);
        room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
            if (track.kind === 'audio') track.attach();
        });
        room.on(RoomEvent.TrackUnsubscribed, (track) => {
            if (track.kind === 'audio') track.detach();
        });

        await room.connect('wss://twilio-i90onacj.livekit.cloud', data.token);
        console.log('Connected to room successfully!');

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
        updateParticipantList();
    } catch (error) {
        console.error('Error leaving room:', error);
        alert('Failed to leave room: ' + error.message);
    }
}

async function toggleMute() {
    if (!room || !room.localParticipant) return;

    try {
        const audioTracks = Array.from(room.localParticipant.tracks.values())
            .filter(publication => publication.kind === 'audio' && publication.source === 'microphone');

        if (!audioTracks.length) return;

        const audioTrack = audioTracks[0];
        if (audioTrack.isMuted) {
            await room.localParticipant.setMicrophoneEnabled(true);
        } else {
            await audioTrack.mute();
        }

        const muteBtn = document.getElementById('muteBtn');
        muteBtn.textContent = audioTrack.isMuted ? 'Muted' : 'Unmuted';
        updateParticipantList();
    } catch (error) {
        console.error('Error toggling mute:', error);
        alert('Failed to toggle mute.');
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
            body: JSON.stringify({ phoneNumber, roomName: 'support-room' }),
        });

        const result = await response.json();
        if (!result.success) throw new Error(result.error);

        alert('Phone call initiated successfully');
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
