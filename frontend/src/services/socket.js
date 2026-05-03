import { io } from 'socket.io-client';

const socket = io('http://127.0.0.1:8000', {
    transports: ['websocket'],
    autoConnect: false, // We'll connect when auth is verified
});

export default socket;
