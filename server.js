const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e7 // 10MB limit for image uploads
});

app.use(express.static(path.join(__dirname, 'public')));

// In-memory data
const users = {}; // username -> { password, role, displayName, avatar }
const activeUsers = {}; // socket.id -> username
const userSockets = {}; // username -> socket.id

// Pre-create Owner
users['RS FLAGS'] = {
    password: '123',
    role: 'RS FLAGS / OWNER',
    displayName: 'RS FLAGS OWNER',
    avatar: ''
};

io.on('connection', (socket) => {

    socket.on('authenticate', ({ username, password, action }) => {
        if (!username || !password) return socket.emit('auth_error', 'Fill all fields.');

        if (action === 'register') {
            if (users[username]) return socket.emit('auth_error', 'Username taken.');
            users[username] = { password, role: 'MEMBER', displayName: username, avatar: '' };
        } else if (action === 'login') {
            if (!users[username] || users[username].password !== password) {
                return socket.emit('auth_error', 'Invalid credentials.');
            }
        }

        activeUsers[socket.id] = username;
        userSockets[username] = socket.id;

        socket.emit('auth_success', {
            username,
            role: users[username].role,
            displayName: users[username].displayName,
            avatar: users[username].avatar
        });

        io.emit('update_online_list', getOnlineUsers());
        io.emit('user_joined', { username, displayName: users[username].displayName });
    });

    socket.on('update_profile', ({ displayName, avatar }) => {
        const username = activeUsers[socket.id];
        if (username && users[username]) {
            if (displayName) users[username].displayName = displayName;
            if (avatar !== undefined) users[username].avatar = avatar;
            io.emit('update_online_list', getOnlineUsers());
        }
    });

    socket.on('send_message', (data) => {
        const username = activeUsers[socket.id];
        if (!username) return;

        const user = users[username];
        const msgPayload = {
            msgId: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            username,
            displayName: user.displayName || username,
            avatar: user.avatar || '',
            role: user.role,
            text: data.text || '',
            images: data.images || [],
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        io.emit('receive_message', msgPayload);
    });

    socket.on('delete_message', (msgId) => {
        const username = activeUsers[socket.id];
        if (!username) return;
        io.emit('message_deleted', msgId);
    });

    // --- WEBRTC SIGNALING ROUTING ---
    socket.on('call_user', ({ targetUsername, signalData, isVideo }) => {
        const callerUsername = activeUsers[socket.id];
        const targetSocketId = userSockets[targetUsername];

        if (targetSocketId && callerUsername) {
            const callerInfo = users[callerUsername] || {};
            io.to(targetSocketId).emit('incoming_call', {
                signal: signalData,
                fromUsername: callerUsername,
                fromDisplayName: callerInfo.displayName || callerUsername,
                fromAvatar: callerInfo.avatar || '',
                isVideo
            });
        } else {
            socket.emit('call_failed', 'User is offline or unavailable.');
        }
    });

    socket.on('answer_call', ({ targetUsername, signalData }) => {
        const targetSocketId = userSockets[targetUsername];
        if (targetSocketId) {
            io.to(targetSocketId).emit('call_accepted', { signal: signalData });
        }
    });

    socket.on('reject_call', ({ targetUsername }) => {
        const targetSocketId = userSockets[targetUsername];
        if (targetSocketId) {
            io.to(targetSocketId).emit('call_rejected');
        }
    });

    socket.on('end_call', ({ targetUsername }) => {
        const targetSocketId = userSockets[targetUsername];
        if (targetSocketId) {
            io.to(targetSocketId).emit('call_ended');
        }
    });

    socket.on('ice_candidate', ({ targetUsername, candidate }) => {
        const targetSocketId = userSockets[targetUsername];
        if (targetSocketId) {
            io.to(targetSocketId).emit('ice_candidate', { candidate });
        }
    });

    socket.on('kick_user', (targetUsername) => {
        const kickerUsername = activeUsers[socket.id];
        if (kickerUsername && users[kickerUsername].role === 'RS FLAGS / OWNER') {
            const targetSocketId = userSockets[targetUsername];
            if (targetSocketId) {
                io.to(targetSocketId).emit('kicked');
            }
        }
    });

    socket.on('disconnect', () => {
        const username = activeUsers[socket.id];
        if (username) {
            delete activeUsers[socket.id];
            delete userSockets[username];
            io.emit('update_online_list', getOnlineUsers());
            io.emit('user_left', { username, displayName: users[username]?.displayName || username });
        }
    });
});

function getOnlineUsers() {
    const list = [];
    for (const [sId, uname] of Object.entries(activeUsers)) {
        if (users[uname]) {
            list.push({
                username: uname,
                displayName: users[uname].displayName || uname,
                avatar: users[uname].avatar || '',
                role: users[uname].role
            });
        }
    }
    return list;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));