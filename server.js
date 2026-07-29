const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    maxHttpBufferSize: 5e7,
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(path.join(__dirname, 'public')));

const users = {};
const registeredUsers = {};

registeredUsers['gw.akira'] = { 
    password: 'Akira@ys7', 
    role: 'RS FLAGS / OWNER',
    displayName: 'Akira (Owner)',
    avatar: '' 
};

io.on('connection', (socket) => {

    socket.on('authenticate', ({ username, password, action }) => {
        const cleanName = username.trim();

        if (action === 'login') {
            if (!registeredUsers[cleanName]) {
                return socket.emit('auth_error', 'User does not exist. Please register.');
            }
            if (registeredUsers[cleanName].password !== password) {
                return socket.emit('auth_error', 'Incorrect password.');
            }
        } else if (action === 'register') {
            if (registeredUsers[cleanName]) {
                return socket.emit('auth_error', 'Username already exists. Please log in.');
            }
            registeredUsers[cleanName] = { 
                password, 
                role: 'MEMBER', 
                displayName: cleanName,
                avatar: '' 
            };
        }

        const role = registeredUsers[cleanName].role;
        const displayName = registeredUsers[cleanName].displayName || cleanName;
        const avatar = registeredUsers[cleanName].avatar || '';
        
        users[socket.id] = { username: cleanName, role, displayName, avatar };

        socket.emit('auth_success', { username: cleanName, role, displayName, avatar });
        io.emit('user_joined', { username: cleanName, displayName, role });
        broadcastOnlineUsers();
    });

    socket.on('update_profile', ({ displayName, avatar }) => {
        const user = users[socket.id];
        if (!user) return;

        if (displayName && displayName.trim().length > 0) {
            user.displayName = displayName.trim();
        }
        if (avatar !== undefined) {
            user.avatar = avatar;
        }

        if (registeredUsers[user.username]) {
            registeredUsers[user.username].displayName = user.displayName;
            registeredUsers[user.username].avatar = user.avatar;
        }

        socket.emit('profile_updated', { displayName: user.displayName, avatar: user.avatar });
        broadcastOnlineUsers();
    });

    socket.on('send_message', (data) => {
        const user = users[socket.id];
        if (!user) return;

        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

        io.emit('receive_message', {
            msgId,
            username: user.username,
            displayName: user.displayName,
            role: user.role,
            avatar: user.avatar,
            text: data.text || '',
            images: data.images || [],
            time
        });
    });

    socket.on('delete_message', (msgId) => {
        io.emit('message_deleted', msgId);
    });

    // --- WEBRTC CALL SIGNALING ---
    socket.on('call_user', ({ targetUsername, signalData, isVideo }) => {
        const caller = users[socket.id];
        let targetSocketId = null;

        for (let id in users) {
            if (users[id].username === targetUsername) {
                targetSocketId = id;
                break;
            }
        }

        if (targetSocketId && caller) {
            io.to(targetSocketId).emit('incoming_call', {
                signal: signalData,
                fromUsername: caller.username,
                fromDisplayName: caller.displayName || caller.username,
                fromAvatar: caller.avatar,
                isVideo
            });
        } else {
            socket.emit('call_failed', 'User is offline or unavailable.');
        }
    });

    socket.on('answer_call', ({ targetUsername, signalData }) => {
        let targetSocketId = null;
        for (let id in users) {
            if (users[id].username === targetUsername) {
                targetSocketId = id;
                break;
            }
        }
        if (targetSocketId) {
            io.to(targetSocketId).emit('call_accepted', { signal: signalData });
        }
    });

    socket.on('reject_call', ({ targetUsername }) => {
        let targetSocketId = null;
        for (let id in users) {
            if (users[id].username === targetUsername) {
                targetSocketId = id;
                break;
            }
        }
        if (targetSocketId) {
            io.to(targetSocketId).emit('call_rejected');
        }
    });

    socket.on('end_call', ({ targetUsername }) => {
        let targetSocketId = null;
        for (let id in users) {
            if (users[id].username === targetUsername) {
                targetSocketId = id;
                break;
            }
        }
        if (targetSocketId) {
            io.to(targetSocketId).emit('call_ended');
        }
    });

    socket.on('ice_candidate', ({ targetUsername, candidate }) => {
        let targetSocketId = null;
        for (let id in users) {
            if (users[id].username === targetUsername) {
                targetSocketId = id;
                break;
            }
        }
        if (targetSocketId) {
            io.to(targetSocketId).emit('ice_candidate', { candidate });
        }
    });

    socket.on('kick_user', (targetUsername) => {
        const requester = users[socket.id];
        if (requester && requester.role === 'RS FLAGS / OWNER') {
            for (let id in users) {
                if (users[id].username === targetUsername) {
                    io.to(id).emit('kicked');
                    delete users[id];
                    break;
                }
            }
            broadcastOnlineUsers();
            io.emit('system_message', `${targetUsername} was kicked by RS FLAGS Owner.`);
        }
    });

    socket.on('disconnect', () => {
        if (users[socket.id]) {
            const displayName = users[socket.id].displayName || users[socket.id].username;
            delete users[socket.id];
            io.emit('user_left', { displayName });
            broadcastOnlineUsers();
        }
    });

    function broadcastOnlineUsers() {
        const onlineList = Object.values(users).map(u => ({ 
            username: u.username, 
            displayName: u.displayName, 
            role: u.role, 
            avatar: u.avatar 
        }));
        io.emit('update_online_list', onlineList);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`RS FLAGS Chat server running on port ${PORT}`);
});