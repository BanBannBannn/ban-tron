/** Cấu hình kênh realtime của một phòng – dùng chung cho app và bộ test. */
export const roomTopic = (roomId: string) => `room:${roomId}`;

export function roomChannelConfig(userId: string) {
  return {
    config: {
      // private: chỉ thành viên phòng được nghe/gửi (xem policy trên realtime.messages)
      private: true,
      broadcast: { self: false, ack: false },
      presence: { key: userId },
    },
  };
}
