class ChatRoom {
    constructor() {
        this.chatMessages = [];
    }

    addMessage(message, seat, createdAt = new Date()) {
        if (message) {
            const newMessage = {
                message,
                createdAt,
                seat
            };
            this.chatMessages.push(newMessage);
            return newMessage;
        }
        return null;
    }
}

module.exports = ChatRoom;
