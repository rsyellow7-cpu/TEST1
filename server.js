const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Increase max payload size to 100MB to allow video and multiple image uploads over sockets
const io = new Server(server, {
    maxHttpBufferSize: 1e8 // 100 MB
});

app.use(express.static(path.join(__dirname, 'public')));

// In-memory user database
const users = new Map();

function getOnlineUsers() {
    const list = [];
    users.forEach((data, username) => {
        if (data.socketId) {
            list.push({
                username,
                displayName: data.displayName || username,
                avatar: data.avatar || '',
                bio: data.bio || '',
                role: data.role || 'MEMBER'
            });
        }
    });
    return list;
}

io.on('connection', (socket) => {
    let currentUsername = null;

    socket.on('authenticate', ({ username, password, action }) => {
        if (!username || !password) {
            return socket.emit('auth_error', 'Username and password required.');
        }

        if (action === 'register') {
            if (users.has(username)) {
                return socket.emit('auth_error', 'Username already exists.');
            }
            const role = (username.toLowerCase() === 'owner' || username.toLowerCase() === 'rs') ? 'RS FLAGS / OWNER' : 'MEMBER';
            users.set(username, { password, displayName: username, avatar: '', bio: '', role, socketId: socket.id });
            currentUsername = username;
        } else {
            const user = users.get(username);
            if (!user || user.password !== password) {
                return socket.emit('auth_error', 'Invalid username or password.');
            }
            user.socketId = socket.id;
            currentUsername = username;
        }

        const userData = users.get(currentUsername);
        socket.emit('auth_success', {
            username: currentUsername,
            displayName: userData.displayName,
            avatar: userData.avatar,
            bio: userData.bio,
            role: userData.role
        });

        io.emit('update_online_list', getOnlineUsers());
    });

    socket.on('send_message', (data) => {
        if (!currentUsername) return;
        const user = users.get(currentUsername);
        if (!user) return;

        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        // Broadcasts message text, array of images, voice note (audio), or video
        io.emit('receive_message', {
            username: currentUsername,
            displayName: user.displayName || currentUsername,
            avatar: user.avatar || '',
            bio: user.bio || '',
            role: user.role || 'MEMBER',
            text: data.text || '',
            images: data.images || [],
            audio: data.audio || null,
            video: data.video || null,
            time: timeStr
        });
    });

    socket.on('disconnect', () => {
        if (currentUsername) {
            const user = users.get(currentUsername);
            if (user && user.socketId === socket.id) {
                user.socketId = null;
            }
            io.emit('update_online_list', getOnlineUsers());
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});