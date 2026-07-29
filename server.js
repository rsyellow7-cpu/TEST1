const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 2e7, // 20MB limit for high-speed multi-image payloads
    pingTimeout: 60000,
    pingInterval: 25000
});

app.use(express.static(path.join(__dirname, 'public')));

// In-memory databases
const users = {};       // lowercase username -> { password, role, displayName, avatar, bio }
const activeUsers = {}; // socket.id -> lowercase username
const userSockets = {}; // lowercase username -> Set of socket.ids

// Pre-create/Enforce Owner Account
const OWNER_USERNAME = 'gw.akira';
users[OWNER_USERNAME] = {
    password: 'Akira@ys7',
    role: 'RS FLAGS / OWNER',
    displayName: 'AKIRA (OWNER)',
    avatar: '',
    bio: 'Server Owner & Administrator'
};

io.on('connection', (socket) => {

    socket.on('authenticate', ({ username, password, action }) => {
        if (!username || !password) return socket.emit('auth_error', 'Please fill in all fields.');

        const cleanUsername = username.trim().toLowerCase();

        if (cleanUsername === OWNER_USERNAME) {
            if (password !== users[OWNER_USERNAME].password) {
                return socket.emit('auth_error', 'Invalid password for Owner account.');
            }
            users[OWNER_USERNAME].role = 'RS FLAGS / OWNER';
        } else if (action === 'register') {
            if (users[cleanUsername]) return socket.emit('auth_error', 'Username already taken.');
            users[cleanUsername] = { 
                password, 
                role: 'MEMBER', 
                displayName: username, 
                avatar: '', 
                bio: 'Hey there! I am using YS Chat.' 
            };
        } else if (action === 'login') {
            if (!users[cleanUsername] || users[cleanUsername].password !== password) {
                return socket.emit('auth_error', 'Invalid username or password.');
            }
        }

        activeUsers[socket.id] = cleanUsername;
        if (!userSockets[cleanUsername]) {
            userSockets[cleanUsername] = new Set();
        }
        userSockets[cleanUsername].add(socket.id);

        socket.emit('auth_success', {
            username: cleanUsername,
            role: users[cleanUsername].role,
            displayName: users[cleanUsername].displayName,
            avatar: users[cleanUsername].avatar,
            bio: users[cleanUsername].bio || ''
        });

        io.emit('update_online_list', getOnlineUsers());
        io.emit('user_joined', { username: cleanUsername, displayName: users[cleanUsername].displayName });
    });

    socket.on('update_profile', ({ displayName, avatar, bio }) => {
        const username = activeUsers[socket.id];
        if (username && users[username]) {
            if (displayName) users[username].displayName = displayName;
            if (avatar !== undefined) users[username].avatar = avatar;
            if (bio !== undefined) users[username].bio = bio;
            
            socket.emit('profile_updated', users[username]);
            io.emit('update_online_list', getOnlineUsers());
        }
    });

    // --- MESSAGING WITH FAST MULTI-IMAGE SUPPORT ---
    socket.on('send_message', (data) => {
        const username = activeUsers[socket.id];
        if (!username) return;

        const user = users[username];
        const msgPayload = {
            msgId: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            username,
            displayName: user.displayName || username,
            avatar: user.avatar || '',
            bio: user.bio || '',
            role: user.role,
            text: data.text || '',
            images: Array.isArray(data.images) ? data.images : [], // Array of compressed Base64 images
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        io.emit('receive_message', msgPayload);
    });

    // --- CALL ROUTING WITH MULTI-DEVICE SUPPORT ---
    socket.on('call_user', ({ targetUsername, signalData, isVideo }) => {
        const callerUsername = activeUsers[socket.id];
        const targetClean = targetUsername ? targetUsername.trim().toLowerCase() : '';
        const targetSocketSet = userSockets[targetClean];

        if (callerUsername && targetSocketSet && targetSocketSet.size > 0) {
            const callerInfo = users[callerUsername] || {};
            
            targetSocketSet.forEach(sId => {
                io.to(sId).emit('incoming_call', {
                    signal: signalData,
                    fromUsername: callerUsername,
                    fromDisplayName: callerInfo.displayName || callerUsername,
                    fromAvatar: callerInfo.avatar || '',
                    fromBio: callerInfo.bio || '',
                    isVideo,
                    isOwnerCall: (targetClean === OWNER_USERNAME || callerUsername === OWNER_USERNAME)
                });
            });
        } else {
            socket.emit('call_failed', 'User is currently offline or unavailable.');
        }
    });

    socket.on('answer_call', ({ targetUsername, signalData }) => {
        const targetClean = targetUsername ? targetUsername.trim().toLowerCase() : '';
        const targetSocketSet = userSockets[targetClean];
        if (targetSocketSet) {
            targetSocketSet.forEach(sId => io.to(sId).emit('call_accepted', { signal: signalData }));
        }
    });

    socket.on('reject_call', ({ targetUsername }) => {
        const targetClean = targetUsername ? targetUsername.trim().toLowerCase() : '';
        const targetSocketSet = userSockets[targetClean];
        if (targetSocketSet) {
            targetSocketSet.forEach(sId => io.to(sId).emit('call_rejected'));
        }
    });

    socket.on('end_call', ({ targetUsername }) => {
        const targetClean = targetUsername ? targetUsername.trim().toLowerCase() : '';
        const targetSocketSet = userSockets[targetClean];
        if (targetSocketSet) {
            targetSocketSet.forEach(sId => io.to(sId).emit('call_ended'));
        }
    });

    socket.on('ice_candidate', ({ targetUsername, candidate }) => {
        const targetClean = targetUsername ? targetUsername.trim().toLowerCase() : '';
        const targetSocketSet = userSockets[targetClean];
        if (targetSocketSet) {
            targetSocketSet.forEach(sId => io.to(sId).emit('ice_candidate', { candidate }));
        }
    });

    // --- OWNER CONTROL HANDLERS ---
    socket.on('assign_role', ({ targetUsername, newRole }) => {
        const adminUsername = activeUsers[socket.id];
        if (adminUsername && users[adminUsername].role === 'RS FLAGS / OWNER') {
            const targetClean = targetUsername.trim().toLowerCase();
            if (users[targetClean]) {
                users[targetClean].role = newRole;
                io.emit('update_online_list', getOnlineUsers());
            }
        }
    });

    socket.on('kick_user', (targetUsername) => {
        const kickerUsername = activeUsers[socket.id];
        if (kickerUsername && users[kickerUsername].role === 'RS FLAGS / OWNER') {
            const targetClean = targetUsername.trim().toLowerCase();
            const targetSocketSet = userSockets[targetClean];
            if (targetSocketSet) {
                targetSocketSet.forEach(sId => io.to(sId).emit('kicked'));
            }
        }
    });

    socket.on('disconnect', () => {
        const username = activeUsers[socket.id];
        if (username) {
            delete activeUsers[socket.id];
            if (userSockets[username]) {
                userSockets[username].delete(socket.id);
                if (userSockets[username].size === 0) {
                    delete userSockets[username];
                }
            }
            io.emit('update_online_list', getOnlineUsers());
        }
    });
});

function getOnlineUsers() {
    const list = [];
    const added = new Set();
    for (const [sId, uname] of Object.entries(activeUsers)) {
        if (users[uname] && !added.has(uname)) {
            added.add(uname);
            list.push({
                username: uname,
                displayName: users[uname].displayName || uname,
                avatar: users[uname].avatar || '',
                bio: users[uname].bio || '',
                role: users[uname].role
            });
        }
    }
    return list;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));