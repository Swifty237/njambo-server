class ChatRoom {
    constructor() {
        this.chatMessages = [];
    }

    addMessage(name, message, seatId, createdAt = new Date()) {
        if (message) {
            const newMessage = {
                name,
                message,
                createdAt,
                seatId
            };
            this.chatMessages.push(newMessage);
            return newMessage;
        }
        return null;
    }
}

module.exports = ChatRoom;
