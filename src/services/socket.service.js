import { Server } from "socket.io";

let io;

const initializeSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
            credentials: true
        },
        transports: ["websocket", "polling"]
    });

    //middleware for auth
    io.use((socket, next) => {
        const userId =
            socket.handshake.auth?.userId ||
            socket.handshake.query?.userId ||
            socket.handshake.headers?.userid;


        if (!userId) {
            return next(new Error("Authentication Error"));
        }
        socket.userId = userId;
        next();
    });

    io.on('connection', (socket) => {
        console.log(`user connected : ${socket.id}`);

        //Store user connection
        if (socket.userId) {
            const userId = socket.userId;
            socket.join(`user-${userId}`);
            console.log(`user ${socket.userId} mapped to socket ${socket.id} `);
        }
        //handle joining specific rooms (like order room , payment room)
        socket.on('join-room', (roomName) => {
            socket.join(roomName);
            console.log(`Socket ${socket.id} joined room : ${roomName}`);
        })

        socket.on('leave-room', (roomName) => {
            socket.leave(roomName);
            console.log(`Socket ${socket.id} left room : ${roomName}`);
        })
        socket.on('disconnect', () => {
            console.log(`user disconnected : ${socket.id}`);
        })
    })
    return io;
};

const getIO = () => {
    if (!io) {
        throw new Error("socket.io not initialize")
    }
    return io;
}

export {
    initializeSocket,
    getIO
}