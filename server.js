const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Enable 50MB payload limit for Socket.IO image & profile picture transfers
const io = new Server(server, {
    maxHttpBufferSize: 5e7,
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(path.join(__dirname, 'public')));

const users = {};
const registeredUsers = {};

// Default Owner Credentials
registeredUsers['gw.akira'] = { 
    password: 'Akira@ys7', 
    role: 'RS FLAGS / OWNER',
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
            registeredUsers[cleanName] = { password, role: 'MEMBER', avatar: '' };
        }

        const role = registeredUsers[cleanName].role;
        const avatar = registeredUsers[cleanName].avatar || '';
        
        users[socket.id] = { username: cleanName, role, avatar };

        socket.emit('auth_success', { username: cleanName, role, avatar });
        io.emit('user_joined', { username: cleanName, role });
        broadcastOnlineUsers();
    });

    // Update Profile Photo / Avatar
    socket.on('update_profile', ({ avatar }) => {
        const user = users[socket.id];
        if (!user) return;

        user.avatar = avatar;
        if (registeredUsers[user.username]) {
            registeredUsers[user.username].avatar = avatar;
        }

        socket.emit('profile_updated', { avatar });
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
            role: user.role,
            avatar: user.avatar,
            text: data.text || '',
            images: data.images || [],
            time
        });
    });

    // Delete message
    socket.on('delete_message', (msgId) => {
        io.emit('message_deleted', msgId);
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
            const username = users[socket.id].username;
            delete users[socket.id];
            io.emit('user_left', { username });
            broadcastOnlineUsers();
        }
    });

    function broadcastOnlineUsers() {
        const onlineList = Object.values(users).map(u => ({ username: u.username, role: u.role, avatar: u.avatar }));
        io.emit('update_online_list', onlineList);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`RS FLAGS Chat server running on port ${PORT}`);
});